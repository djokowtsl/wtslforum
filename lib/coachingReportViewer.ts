import type {
  Te4CourtSurface,
  Te4Highlight,
  Te4SetScore,
  Te4ViewerData,
  Te4ViewerPoint,
  Te4ViewerShot,
} from './te4DmoTypes';

export const MAX_COACHING_REPLAY_BYTES = 64 * 1024 * 1024;
export const COACHING_REPLAY_STAGING_PREFIX = 'dmo-coaching-report-staging/';

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function boundedNumber(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function boundedInteger(value: unknown, min: number, max: number): value is number {
  return Number.isSafeInteger(value) && boundedNumber(value, min, max);
}

function safeText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').trim();
  return text.length <= maxLength ? text : null;
}

function parseSetScores(value: unknown, maxSets: number): Te4SetScore[] | null {
  if (!Array.isArray(value) || value.length > maxSets) return null;
  const scores: Te4SetScore[] = [];
  for (const pair of value) {
    if (
      !Array.isArray(pair)
      || pair.length !== 2
      || !boundedInteger(pair[0], 0, 99)
      || !boundedInteger(pair[1], 0, 99)
    ) return null;
    scores.push([pair[0], pair[1]]);
  }
  return scores;
}

function parseHighlights(value: unknown): Te4Highlight[] | null {
  if (!Array.isArray(value) || value.length > 500) return null;
  const highlights: Te4Highlight[] = [];
  for (const raw of value) {
    if (!isRecord(raw)) return null;
    const rewatch = safeText(raw.rewatch, 100);
    const games = safeText(raw.games, 60);
    const reasons = safeText(raw.reasons, 500);
    if (
      !boundedInteger(raw.point, 1, 100_000)
      || !boundedInteger(raw.frame, 0, 100_000_000)
      || !boundedInteger(raw.set, 1, 100)
      || (raw.winner !== 1 && raw.winner !== 2)
      || !boundedNumber(raw.wp, 0, 1)
      || !boundedNumber(raw.importance, 0, 1_000_000)
      || !boundedNumber(raw.excitement, 0, 1_000_000)
      || !boundedNumber(raw.score, 0, 1_000_000)
      || !boundedInteger(raw.rally, 0, 100_000)
      || !rewatch
      || !games
      || reasons === null
    ) return null;
    highlights.push({
      point: raw.point,
      rewatch,
      frame: raw.frame,
      set: raw.set,
      games,
      winner: raw.winner,
      wp: raw.wp,
      importance: raw.importance,
      excitement: raw.excitement,
      score: raw.score,
      reasons,
      rally: raw.rally,
    });
  }
  return highlights;
}

function parseShot(value: unknown): Te4ViewerShot | null {
  if (!isRecord(value)) return null;
  const coordinates = [value.bx, value.by, value.bt];
  if (
    (value.p !== 1 && value.p !== 2)
    || !boundedInteger(value.t, 0, 100_000_000)
    || (value.k !== 's' && value.k !== 'r')
    || !boundedNumber(value.v, 0, 100_000)
    || !boundedNumber(value.z, 0, 100_000)
    || !boundedNumber(value.d, 0, 1_000_000)
    || coordinates.some((item) => item !== null && !boundedNumber(item, -1_000_000, 1_000_000))
    || !boundedNumber(value.en, -1_000, 1_000)
    || !boundedNumber(value.br, -1_000, 1_000)
  ) return null;
  return {
    p: value.p,
    t: value.t,
    k: value.k,
    v: value.v,
    z: value.z,
    d: value.d,
    bx: value.bx as number | null,
    by: value.by as number | null,
    bt: value.bt as number | null,
    en: value.en,
    br: value.br,
  };
}

function parsePoint(value: unknown): Te4ViewerPoint | null {
  if (!isRecord(value)) return null;
  const sets = parseSetScores(value.ss, 100);
  const rs = safeText(value.rs, 500);
  const rt = safeText(value.rt, 100);
  const games = safeText(value.g, 60);
  const points = safeText(value.pt, 60);
  if (
    !boundedInteger(value.k, 1, 100_000)
    || !boundedInteger(value.mf, 0, 100_000_000)
    || !boundedInteger(value.fc, 1, 100_000_000)
    || !sets
    || !boundedNumber(value.sc, 0, 1_000_000)
    || rs === null
    || !boundedNumber(value.wp, 0, 1)
    || rt === null
    || !boundedInteger(value.set, 1, 100)
    || games === null
    || points === null
    || (value.tb !== 0 && value.tb !== 1)
    || (value.s !== 1 && value.s !== 2)
    || (value.w !== 1 && value.w !== 2)
    || !boundedInteger(value.f, 0, 10_000)
    || !boundedInteger(value.n, 0, 100_000)
    || typeof value.inferred !== 'boolean'
    || !Array.isArray(value.sh)
    || value.sh.length > 100_000
  ) return null;
  const shots = value.sh.map(parseShot);
  if (shots.some((shot) => shot === null)) return null;
  return {
    k: value.k,
    mf: value.mf,
    fc: value.fc,
    ss: sets,
    sc: value.sc,
    rs,
    wp: value.wp,
    rt,
    set: value.set,
    g: games,
    pt: points,
    tb: value.tb,
    s: value.s,
    w: value.w,
    f: value.f,
    n: value.n,
    inferred: value.inferred,
    sh: shots as Te4ViewerShot[],
  };
}

export function sanitizeCoachingViewerData(value: unknown): Te4ViewerData | null {
  if (!isRecord(value)) return null;
  const names = value.names;
  if (!Array.isArray(names) || names.length !== 2) return null;
  const player1 = safeText(names[0], 100);
  const player2 = safeText(names[1], 100);
  const score = safeText(value.score, 100);
  const tournament = value.tournament === null ? null : safeText(value.tournament, 160);
  const surface = value.surface;
  const sets = parseSetScores(value.sets, 100);
  const highlights = parseHighlights(value.highlights);
  const final = value.final;
  const match = value.match;
  if (
    !player1
    || !player2
    || !score
    || (value.tournament !== null && tournament === null)
    || !['hard', 'clay', 'grass', 'unknown'].includes(String(surface))
    || !sets
    || !highlights
    || !isRecord(final)
    || !isRecord(match)
    || !Array.isArray(value.pts)
    || value.pts.length < 1
    || value.pts.length > 100_000
  ) return null;

  const finalSets = parseSetScores(final.ss, 100);
  if (!finalSets || !boundedNumber(final.wp, 0, 1)) return null;
  const matchData = match.d;
  if (
    typeof matchData !== 'string'
    || matchData.length > Math.ceil(MAX_COACHING_REPLAY_BYTES / 3) * 4
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(matchData)
    || !boundedInteger(match.n, 1, 10_000_000)
    || !boundedNumber(match.fps, 1, 120)
  ) return null;
  const frameBytes = Buffer.from(matchData, 'base64');
  if (frameBytes.length > MAX_COACHING_REPLAY_BYTES || frameBytes.length !== match.n * 14) return null;
  const points = value.pts.map(parsePoint);
  if (points.some((point) => point === null)) return null;

  return {
    names: [player1, player2],
    score,
    tournament,
    surface: surface as Te4CourtSurface,
    highlights,
    sets,
    final: { ss: finalSets, wp: final.wp },
    match: { d: matchData, n: match.n, fps: match.fps },
    pts: points as Te4ViewerPoint[],
  };
}

export function isCoachingReplayStagingPath(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= 180
    && value.startsWith(COACHING_REPLAY_STAGING_PREFIX)
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.json$/i
      .test(value.slice(COACHING_REPLAY_STAGING_PREFIX.length));
}
