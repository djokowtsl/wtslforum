export type Te4TvScalar = string | number;

export type Te4TvAlignedPoint = {
  gameWinnerMapped: number;
  winnerAgrees: boolean;
  gameStats: Record<string, Te4TvScalar>;
  lastShot: Record<string, Te4TvScalar>;
  errorKind: 'long' | 'wide' | 'net' | '';
  isError: boolean;
  serverAgrees: boolean | null;
};

export type Te4TvLogAlignment = {
  offset: number;
  flippedPlayers: boolean;
  matchedPoints: number;
  winnerAgreements: number;
  winnerAgreementRate: number;
  serverAgreements: number;
  serverComparisons: number;
  reliable: boolean;
  byPoint: Record<number, Te4TvAlignedPoint>;
};

type DmoPoint = { k: number; s: 1 | 2; w: 1 | 2 };
type LogEvent = {
  point?: Record<string, Te4TvScalar>;
  shot?: Record<string, Te4TvScalar>;
};

const FIELD_PATTERN = /(\w+)=([^\s]*)/g;
export const TE4TV_POINT_FIELDS = [
  'nbstrike', 'bp', 'sp', 'key', 'top5', 'crowd',
  'srv1spd', 'srvnum', 'rallysec',
];
export const TE4TV_SHOT_FIELDS = [
  'type', 'ctrl', 'timing', 'power', 'dtl', 'cross', 'passing', 'wrongfoot',
  'greatget', 'volley', 'lob', 'tough', 'angle', 'sharp', 'speed', 'net',
  'close', 'wide', 'long',
];

function scalar(value: string): Te4TvScalar {
  if (value.trim() && Number.isFinite(Number(value))) return Number(value);
  return value;
}

function parseFields(text: string): Record<string, Te4TvScalar> {
  const result: Record<string, Te4TvScalar> = {};
  for (const match of text.matchAll(FIELD_PATTERN)) {
    result[match[1]] = scalar(match[2]);
  }
  return result;
}

function numeric(value: Te4TvScalar | undefined): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function parseEvents(text: string): Map<number, LogEvent> {
  const events = new Map<number, LogEvent>();
  for (const line of text.split(/\r?\n/)) {
    const match = /TE4TV\s+(POINT|SHOT|SCORE)\s+(.*)$/.exec(line);
    if (!match) continue;
    const fields = parseFields(match[2]);
    const index = numeric(fields.n);
    if (index === null || !Number.isInteger(index) || index < 0 || index > 50_000) continue;
    const event = events.get(index) ?? {};
    if (match[1] === 'POINT') event.point = fields;
    if (match[1] === 'SHOT') event.shot = fields;
    events.set(index, event);
  }
  return events;
}

function inspectOffset(points: DmoPoint[], events: Map<number, LogEvent>, offset: number) {
  let compared = 0;
  let same = 0;
  for (const point of points) {
    const winner = numeric(events.get(point.k + offset)?.point?.winner);
    if (winner !== 1 && winner !== 2) continue;
    compared += 1;
    if (winner === point.w) same += 1;
  }
  const flippedPlayers = compared > 0 && same < compared / 2;
  const agreements = flippedPlayers ? compared - same : same;
  const rate = compared ? agreements / compared : 0;
  return {
    offset,
    compared,
    same,
    flippedPlayers,
    agreements,
    rate,
    rank: rate * Math.sqrt(compared),
  };
}

function errorKind(shot: Record<string, Te4TvScalar> | undefined): 'long' | 'wide' | 'net' | '' {
  if (!shot) return '';
  if ((numeric(shot.long) ?? 0) > 0) return 'long';
  if ((numeric(shot.wide) ?? 0) > 0) return 'wide';
  if (numeric(shot.net) === 2) return 'net';
  return '';
}

/**
 * Aligns local TE4TV Director Mode events against DMO point winners.
 * The text log is parsed in the browser and is never uploaded by this helper.
 */
export function alignTe4TvLog(
  text: string,
  points: DmoPoint[],
  offsetOverride?: number,
): Te4TvLogAlignment {
  const events = parseEvents(text);
  let maxEvent = 0;
  for (const index of events.keys()) maxEvent = Math.max(maxEvent, index);
  const offsetSpan = Math.min(1000, Math.max(maxEvent, points.length));
  const offsets = offsetOverride === undefined
    ? Array.from(
      { length: offsetSpan * 2 + 1 },
      (_, index) => index - offsetSpan,
    )
    : [Math.max(-50_000, Math.min(50_000, Math.trunc(offsetOverride)))];
  const candidates = offsets.map((offset) => inspectOffset(points, events, offset));
  const best = candidates.sort((a, b) => b.rank - a.rank || b.compared - a.compared)[0]
    ?? inspectOffset(points, events, 0);
  const minimumMatches = Math.min(8, Math.max(3, Math.ceil(points.length * 0.2)));
  const reliable = best.compared >= minimumMatches && best.rate >= 0.8;
  const byPoint: Record<number, Te4TvAlignedPoint> = {};
  let serverComparisons = 0;
  let serverAgreements = 0;

  if (reliable) {
    for (const point of points) {
      const event = events.get(point.k + best.offset);
      const gamePoint = event?.point;
      const winner = numeric(gamePoint?.winner);
      if (!gamePoint || (winner !== 1 && winner !== 2)) continue;
      const gameWinnerMapped = best.flippedPlayers ? 3 - winner : winner;
      const rawServer = numeric(gamePoint.srvnum);
      const mappedServer = rawServer === 1 || rawServer === 2
        ? best.flippedPlayers ? 3 - rawServer : rawServer
        : null;
      const serverAgrees = mappedServer === null ? null : mappedServer === point.s;
      if (serverAgrees !== null) {
        serverComparisons += 1;
        serverAgreements += Number(serverAgrees);
      }
      const shot = event.shot ?? {};
      byPoint[point.k] = {
        gameWinnerMapped,
        winnerAgrees: gameWinnerMapped === point.w,
        gameStats: Object.fromEntries(
          TE4TV_POINT_FIELDS
            .filter((key) => gamePoint[key] !== undefined)
            .map((key) => [key, gamePoint[key]]),
        ),
        lastShot: Object.fromEntries(
          TE4TV_SHOT_FIELDS
            .filter((key) => shot[key] !== undefined)
            .map((key) => [key, shot[key]]),
        ),
        errorKind: errorKind(event.shot),
        isError: Boolean(errorKind(event.shot)),
        serverAgrees,
      };
    }
  }

  return {
    offset: best.offset,
    flippedPlayers: best.flippedPlayers,
    matchedPoints: best.compared,
    winnerAgreements: best.agreements,
    winnerAgreementRate: best.rate,
    serverAgreements,
    serverComparisons,
    reliable,
    byPoint,
  };
}
