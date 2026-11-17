// Replay navigation: the point index behind the seek-bar markers, the point
// list, previous/next point, shareable moments and playback speeds. Pure
// functions, worked out once per replay, never per frame.

/** Playback speeds offered for full replays, slowest first. */
export const DMO_REPLAY_SPEEDS = Object.freeze([0.25, 0.5, 1, 2, 4, 8]);

/** Within this many seconds of a point's start, "previous" goes to the point before. */
export const DMO_REPLAY_RESTART_SECONDS = 2;

function gamePair(value) {
  const numbers = String(value ?? '').match(/\d+/g)?.map(Number);
  return numbers?.length >= 2 && numbers.every(Number.isInteger) ? [numbers[0], numbers[1]] : null;
}

function outcomeOf(point) {
  const shots = Array.isArray(point.sh) ? point.sh : [];
  if (Number(point.f) >= 2) return 'double-fault';
  if (shots.length === 1 && point.w === point.s) return 'ace';
  const lastHitter = shots.at(-1)?.p;
  if (lastHitter !== 1 && lastHitter !== 2) return null;
  return lastHitter === point.w ? 'winner' : 'error';
}

/**
 * One entry per recorded point, in order. Scores are the score before the
 * point (as the recording stores them). `endsGame`, `endsSet` and `isBreak`
 * describe what the point decided.
 */
export function buildDmoReplayPointIndex(points, options = {}) {
  if (!Array.isArray(points)) return [];
  const result = [];
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    if (!point || !Number.isInteger(point.mf) || point.mf < 0) continue;
    const next = points[index + 1];
    const last = !next;
    const count = Number.isInteger(point.fc) && point.fc > 0 ? point.fc : 1;
    const tiebreak = point.tb === 1;
    const endsSet = next ? next.set !== point.set : Boolean(options.matchOver);
    const endsGame = endsSet
      || (next ? (next.s !== point.s || (next.tb === 1 && !tiebreak)) : Boolean(options.matchOver));
    const games = gamePair(point.g);
    result.push({
      index: result.length,
      number: Number.isInteger(point.k) ? point.k : index,
      start: point.mf,
      end: point.mf + count - 1,
      set: Number.isInteger(point.set) ? point.set : 1,
      games: games ? `${games[0]}-${games[1]}` : '',
      score: typeof point.pt === 'string' ? point.pt : '',
      tiebreak,
      server: point.s === 2 ? 2 : 1,
      winner: point.w === 2 ? 2 : point.w === 1 ? 1 : null,
      shots: Array.isArray(point.sh) ? point.sh.length : 0,
      outcome: outcomeOf(point),
      endsGame,
      endsSet,
      endsMatch: last && Boolean(options.matchOver),
      isBreak: endsGame && !tiebreak && (point.w === 1 || point.w === 2) && point.w !== point.s,
    });
  }
  return result;
}

/** Index of the point being played at `frame`: the last one that started at or before it (-1 before the first). */
export function dmoReplayPointAt(index, frame) {
  if (!Array.isArray(index) || !index.length || !Number.isFinite(frame)) return -1;
  let low = 0;
  let high = index.length - 1;
  if (frame < index[0].start) return -1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (index[middle].start <= frame) low = middle;
    else high = middle - 1;
  }
  return low;
}

/**
 * Where "previous point" or "next point" goes from `frame`. Previous restarts
 * the current point unless it started less than DMO_REPLAY_RESTART_SECONDS
 * ago, like a music player. Returns null when there is nowhere to go.
 */
export function dmoReplayAdjacentPointFrame(index, frame, direction, frameRate = 60) {
  if (!Array.isArray(index) || !index.length || !Number.isFinite(frame)) return null;
  const current = dmoReplayPointAt(index, frame);
  if (direction > 0) return index[current + 1]?.start ?? null;
  if (current < 0) return null;
  const restartFrames = DMO_REPLAY_RESTART_SECONDS * Math.max(1, frameRate);
  if (frame - index[current].start > restartFrames || current === 0) return index[current].start;
  return index[current - 1].start;
}

/**
 * Seek-bar marks as fractions of the bar: a tall mark where a set ends, a
 * short one where a game ends. The final point is left out (the bar ends there).
 */
export function dmoReplaySeekMarkers(index, startFrame, endFrame) {
  if (!Array.isArray(index) || !(endFrame > startFrame)) return [];
  const span = endFrame - startFrame;
  const markers = [];
  for (let position = 0; position < index.length - 1; position += 1) {
    const point = index[position];
    if (!point.endsGame) continue;
    const at = index[position + 1].start;
    if (at <= startFrame || at >= endFrame) continue;
    markers.push({ fraction: (at - startFrame) / span, kind: point.endsSet ? 'set' : 'game', point: position + 1 });
  }
  return markers;
}

/** The next speed up (direction 1) or down (-1) from `speed`, staying within the offered speeds. */
export function stepDmoReplaySpeed(speed, direction) {
  const speeds = DMO_REPLAY_SPEEDS;
  let position = speeds.indexOf(speed);
  if (position < 0) position = speeds.indexOf(1);
  return speeds[Math.max(0, Math.min(speeds.length - 1, position + Math.sign(direction)))];
}

/** A valid offered speed, or 1. */
export function normalizeDmoReplaySpeed(value) {
  const number = Number(value);
  return DMO_REPLAY_SPEEDS.includes(number) ? number : 1;
}

/**
 * Reads a replay moment from a link: `t` as seconds ("312"), "5:12",
 * "1:05:12" or "5m12s", or `point` as a point number (1 = first point).
 */
export function parseDmoReplayMoment(search) {
  let params;
  try {
    params = search instanceof URLSearchParams ? search : new URLSearchParams(String(search ?? ''));
  } catch {
    return null;
  }
  const point = params.get('point');
  if (point && /^\d{1,4}$/.test(point) && Number(point) >= 1) return { point: Number(point) };
  const raw = params.get('t')?.trim().toLowerCase();
  if (!raw) return null;
  let seconds = null;
  if (/^\d{1,6}(\.\d+)?$/.test(raw)) seconds = Number(raw);
  else if (/^\d{1,3}(:[0-5]?\d){1,2}$/.test(raw)) {
    seconds = raw.split(':').map(Number).reduce((total, part) => total * 60 + part, 0);
  } else {
    const match = raw.match(/^(?:(\d{1,3})h)?(?:(\d{1,4})m)?(?:(\d{1,6})s)?$/);
    if (match && (match[1] || match[2] || match[3])) {
      seconds = Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
    }
  }
  return seconds !== null && Number.isFinite(seconds) && seconds >= 0 ? { seconds } : null;
}

/** "5:12" or "1:05:12", for links and labels. */
export function formatDmoReplayMoment(seconds) {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = String(total % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}

/** The replay frame a link asks for, given the replay's first frame and point index. */
export function dmoReplayMomentFrame(moment, index, startFrame, endFrame, frameRate = 60) {
  if (!moment) return null;
  let frame = null;
  if (moment.point) frame = index?.[moment.point - 1]?.start ?? null;
  else if (Number.isFinite(moment.seconds)) frame = startFrame + moment.seconds * Math.max(1, frameRate);
  if (frame === null || !Number.isFinite(frame)) return null;
  return Math.max(startFrame, Math.min(endFrame, Math.round(frame)));
}

/**
 * The current page address with `t` set to this moment (and any `point`
 * removed). `params` names the replay, e.g. { match: '23' }.
 */
export function dmoReplayMomentUrl(href, seconds, params = {}) {
  try {
    const url = new URL(href);
    url.searchParams.delete('point');
    for (const [key, value] of Object.entries(params ?? {})) {
      if (typeof value === 'string' && value) url.searchParams.set(key, value);
    }
    url.searchParams.set('t', formatDmoReplayMoment(seconds));
    return url.toString();
  } catch {
    return null;
  }
}

/** A short description of how the point ended, for the point list. */
export function describeDmoReplayPoint(point, players) {
  const name = point.winner ? players?.[point.winner - 1] ?? `Player ${point.winner}` : 'Unknown';
  const how = {
    ace: 'Ace',
    'double-fault': 'Double fault',
    winner: 'Winner',
    error: 'Opponent error',
  }[point.outcome] ?? 'Point';
  const shots = point.outcome === 'ace' || point.outcome === 'double-fault' || point.shots < 2
    ? '' : ` · ${point.shots} shots`;
  return { winner: name, how: `${how}${shots}` };
}
