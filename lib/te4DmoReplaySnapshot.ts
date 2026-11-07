import type { Te4LiveSnapshot, Te4LiveSoundEvent } from './te4DmoLive';
import type { Te4ViewerData, Te4ViewerPoint } from './te4DmoTypes';
import { formatTennisPointScoreCall, formatUmpireSetCall } from './liveCourtUmpire';

const MAX_MATCH_BYTES = 64 * 1024 * 1024;
const COURT_SAMPLE_STEP = 2;

function zeroStats(): Te4LiveSnapshot['stats'][number] {
  return {
    servicePoints: 0,
    servicePointsWon: 0,
    serviceWinRate: null,
    pointsWon: 0,
    firstServeFaults: 0,
    acesOrUnreturned: 0,
  };
}

function gameScore(point: Te4ViewerPoint | undefined): [number, number] {
  return parsedGameScore(point) ?? [0, 0];
}

function parsedGameScore(point: Te4ViewerPoint | undefined): [number, number] | null {
  if (!point) return null;
  const values = point.g.match(/\d+/g)?.map(Number);
  return values?.length === 2 && values.every(Number.isInteger)
    ? [values[0], values[1]]
    : null;
}

function parsePointScoreCounts(
  scoreLabel: string,
  tiebreak: boolean,
): [number, number] | null {
  const score = scoreLabel.trim();
  if (tiebreak) {
    const values = score.match(/^\s*(\d+)\s*[-–]\s*(\d+)\s*$/);
    return values ? [Number(values[1]), Number(values[2])] : null;
  }
  const normalized = score.toUpperCase();
  if (normalized === 'DEUCE') return [3, 3];
  const advantage = normalized.match(/^AD\s*([12])$/);
  if (advantage) return advantage[1] === '1' ? [4, 3] : [3, 4];
  const pair = normalized.match(/^\s*(AD|ADV|A|\d+)\s*[-–]\s*(AD|ADV|A|\d+)\s*$/);
  if (!pair) return null;
  const value = (part: string) => {
    if (part === 'AD' || part === 'ADV' || part === 'A') return 4;
    if (part === '0') return 0;
    if (part === '15') return 1;
    if (part === '30') return 2;
    if (part === '40') return 3;
    return null;
  };
  const first = value(pair[1]);
  const second = value(pair[2]);
  return first === null || second === null ? null : [first, second];
}

function scoreCallAfterLastPoint(
  point: Te4ViewerPoint,
  names: [string, string],
): string | null {
  const winner = point.w - 1;
  const winnerName = names[winner];
  const scores = parsePointScoreCounts(point.pt, point.tb === 1);
  if (!scores) return null;
  const after: [number, number] = [...scores];
  after[winner] += 1;

  if (point.tb === 1) {
    if (Math.max(...after) >= 7 && Math.abs(after[0] - after[1]) >= 2) {
      return formatUmpireSetCall(point.set, winnerName);
    }
    return formatTennisPointScoreCall(`${after[0]}-${after[1]}`, null, names, true);
  }

  if (Math.max(...after) >= 4 && Math.abs(after[0] - after[1]) >= 2) {
    const games = parsedGameScore(point);
    if (games) {
      games[winner] += 1;
      if (Math.max(...games) >= 6 && Math.abs(games[0] - games[1]) >= 2) {
        return formatUmpireSetCall(point.set, winnerName);
      }
    }
    return `Game, ${winnerName}`;
  }

  let scoreLabel: string;
  if (after[0] >= 3 && after[1] >= 3) {
    scoreLabel = after[0] === after[1]
      ? 'deuce'
      : after[0] > after[1] ? 'ad 1' : 'ad 2';
  } else {
    const labels = ['0', '15', '30', '40'];
    scoreLabel = `${labels[Math.min(after[0], 3)]}-${labels[Math.min(after[1], 3)]}`;
  }
  return formatTennisPointScoreCall(scoreLabel, point.s, names);
}

function replayPointScoreCall(
  points: Te4ViewerPoint[],
  pointIndex: number,
  names: [string, string],
): string | null {
  const point = points[pointIndex];
  const nextPoint = points[pointIndex + 1];
  if (!point) return null;
  if (!nextPoint) return scoreCallAfterLastPoint(point, names);

  const winnerName = names[point.w - 1];
  if (nextPoint.set !== point.set) return formatUmpireSetCall(point.set, winnerName);
  const currentGames = parsedGameScore(point);
  const nextGames = parsedGameScore(nextPoint);
  if (
    currentGames
    && nextGames
    && (nextGames[0] > currentGames[0] || nextGames[1] > currentGames[1])
  ) {
    return `Game, ${winnerName}`;
  }
  return formatTennisPointScoreCall(
    nextPoint.pt,
    nextPoint.tb === 1 ? null : nextPoint.s,
    names,
    nextPoint.tb === 1,
  );
}

type ScorePoint = { s?: number; set?: number; tb?: number; g?: string };

/**
 * Whether the players change ends after each recorded point, from the match
 * score rather than from positions or shot attribution: ends change after
 * every odd game of a set, after a set whose game total is odd, and every six
 * points of a tie-break. A game boundary is where the server changes (or the
 * set changes, or a tie-break starts). The count starts from the first point's
 * game score, so a replay that begins mid-set still counts correctly.
 */
export function changeoversAfterPoints(points: ScorePoint[]): boolean[] {
  const result = points.map(() => false);
  const opening = points[0]?.g?.match(/\d+/g)?.map(Number);
  let gamesInSet = opening?.length === 2 && opening.every(Number.isInteger) ? opening[0] + opening[1] : 0;
  let tieBreakPoints = 0;
  for (let i = 0; i + 1 < points.length; i += 1) {
    const point = points[i], next = points[i + 1];
    const tieBreak = Boolean(point.tb);
    if (next.set !== point.set) {
      // Set over: the last game (a tie-break counts as one) completes the set.
      result[i] = (gamesInSet + 1) % 2 === 1;
      gamesInSet = 0;
      tieBreakPoints = 0;
    } else if (tieBreak && next.tb) {
      tieBreakPoints += 1;
      result[i] = tieBreakPoints % 6 === 0;
    } else if (next.tb && !tieBreak) {
      gamesInSet += 1; // 6-6: into the tie-break
      tieBreakPoints = 0;
      result[i] = gamesInSet % 2 === 1;
    } else if (next.s !== point.s) {
      gamesInSet += 1;
      result[i] = gamesInSet % 2 === 1;
    }
  }
  return result;
}

function replayPoint(point: Te4ViewerPoint): Te4LiveSnapshot['recentPoints'][number] {
  return {
    number: point.k,
    scoreLabel: point.pt,
    server: point.s,
    winner: point.w,
    rallyHits: point.sh.length,
    faults: point.f,
  };
}

export function te4ViewerToLiveSnapshot(
  viewer: Te4ViewerData,
  handedness: ['left' | 'right', 'left' | 'right'] = ['right', 'right'],
): Te4LiveSnapshot {
  const frameCount = viewer.match?.n;
  const frameRate = viewer.match?.fps;
  const encodedFrames = viewer.match?.d;
  if (
    !Number.isInteger(frameCount)
    || frameCount < 2
    || !Number.isFinite(frameRate)
    || frameRate <= 0
    || typeof encodedFrames !== 'string'
    || frameCount * 14 > MAX_MATCH_BYTES
  ) {
    throw new Error('The full replay court data is incomplete.');
  }

  const expectedByteLength = frameCount * 14;
  if (encodedFrames.length > Math.ceil(expectedByteLength / 3) * 4 + 4) {
    throw new Error('The full replay court data is incomplete.');
  }
  const bytesString = atob(encodedFrames);
  if (bytesString.length !== expectedByteLength) {
    throw new Error('The full replay court data is incomplete.');
  }
  const bytes = new Uint8Array(bytesString.length);
  for (let index = 0; index < bytesString.length; index += 1) {
    bytes[index] = bytesString.charCodeAt(index);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const court: number[][] = [];
  const courtFrameIndices: number[] = [];
  for (let frame = 0; frame < frameCount; frame += COURT_SAMPLE_STEP) {
    const offset = frame * 14;
    const values = Array.from({ length: 7 }, (_, index) =>
      view.getInt16(offset + index * 2, true),
    );
    if (
      values.slice(0, 2).some((value) => Math.abs(value) > 5000)
      || values[2] < 0
      || values[2] > 1000
      || values.slice(3).some((value) => Math.abs(value) > 5000)
    ) continue;
    court.push(values);
    courtFrameIndices.push(frame);
  }
  if (court.length < 2) throw new Error('The full replay has too few valid court frames.');

  const trajectoryEvents: NonNullable<Te4LiveSnapshot['trajectoryEvents']> = [];
  const soundEvents: Te4LiveSoundEvent[] = [];
  const seenSounds = new Set<string>();
  const addSound = (frame: number, kind: Te4LiveSoundEvent['kind']) => {
    if (!Number.isInteger(frame) || frame < 0 || frame >= frameCount) return;
    const key = `${frame}:${kind}`;
    if (seenSounds.has(key)) return;
    seenSounds.add(key);
    soundEvents.push({ frame, kind });
  };

  // Whether the players change ends after each point comes from the score,
  // so the renderer labels only real changeovers.
  const changeovers = changeoversAfterPoints(viewer.pts);
  for (const [pointIndex, point] of viewer.pts.entries()) {
    for (const shot of point.sh) {
      const frame = point.mf + shot.t;
      if (Number.isInteger(frame) && frame >= 0 && frame < frameCount) {
        trajectoryEvents.push({
          frame,
          kind: 'shot',
          player: shot.p,
          shotType: shot.k === 's' ? 'serve' : 'rally',
          ...(shot.v > 0 ? { speedKmh: shot.v } : {}),
        });
        addSound(frame, 'racket');
      }
      if (shot.bt !== null) addSound(point.mf + shot.bt, 'bounce');
    }
    if (point.fc > 0) {
      const endFrame = Math.min(frameCount - 1, point.mf + point.fc - 1);
      if (endFrame >= 0) {
        // DMO point and game labels are the score before that point. At its
        // end, the next row carries the updated score and game/set transition.
        const scoreCall = replayPointScoreCall(viewer.pts, pointIndex, viewer.names);
        trajectoryEvents.push({
          frame: endFrame,
          kind: 'point-end',
          changeover: changeovers[pointIndex],
          ...(scoreCall ? { scoreCall } : {}),
        });
      }
    }
  }
  trajectoryEvents.sort((first, second) =>
    first.frame - second.frame
    || (first.kind === second.kind ? 0 : first.kind === 'shot' ? -1 : 1),
  );
  soundEvents.sort((first, second) => first.frame - second.frame || first.kind.localeCompare(second.kind));

  const lastPoint = viewer.pts.at(-1);
  const sets = viewer.final.ss.map(([first, second]) => [first, second] as [number, number]);
  const games = gameScore(lastPoint);
  const playerOneChance = Math.max(0, Math.min(1, Number(viewer.final.wp)));
  const recentPoints = viewer.pts.slice(-12).map(replayPoint);
  const points = [
    Number(lastPoint?.pt.match(/\d+/)?.[0] ?? 0),
    Number(lastPoint?.pt.match(/\d+$/)?.[0] ?? 0),
  ] as [number, number];

  return {
    version: 1,
    filename: `Full replay: ${viewer.names[0]} vs ${viewer.names[1]}`.slice(0, 120),
    stadium: viewer.tournament?.slice(0, 80) ?? null,
    players: viewer.names,
    frameCount,
    frameRate,
    courtFrameCount: frameCount,
    pointCount: viewer.pts.length,
    bestOf: sets.length >= 5 ? 5 : 3,
    score: {
      sets,
      games,
      points,
      pointText: lastPoint?.pt.includes('-')
        ? lastPoint.pt.split('-').slice(0, 2).map((value) => value.slice(0, 4)) as [string, string]
        : ['—', '—'],
      tiebreak: lastPoint?.tb === 1,
      server: lastPoint?.s ?? null,
    },
    currentPoint: {
      number: (lastPoint?.k ?? 0) + 1,
      server: lastPoint?.s ?? null,
      rallyHits: lastPoint?.sh.length ?? 0,
      serveSpeedKmh: lastPoint?.sh.find((shot) => shot.k === 's')?.v ?? null,
      inProgress: false,
    },
    winChance: [playerOneChance, 1 - playerOneChance],
    winHistory: [],
    stats: [zeroStats(), zeroStats()],
    recentPoints,
    court,
    courtFrameIndices,
    trajectoryEvents,
    soundEvents,
    handedness,
  };
}
