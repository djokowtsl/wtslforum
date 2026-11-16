import { chooseDmoPointGestures, dmoGestureType, getDmoCharacterGestures } from './dmoCharacterGestures.mjs';

/**
 * Build deterministic, point-anchored reactions: match and set wins, breaks
 * of serve, long rallies and double faults (see chooseDmoPointGestures).
 * Ordinary short points stay quiet.
 */
export function buildDmoPointGestureEvents(
  points,
  { characters = [null, null], matchOver = false, bestOf = null } = {},
) {
  if (!Array.isArray(points)) return [];
  const orderedPoints = points
    .filter((point) => Number.isFinite(point?.frame) && (point.winner === 1 || point.winner === 2))
    .slice()
    .sort((a, b) => a.frame - b.frame);
  const events = [];
  for (let index = 0; index < orderedPoints.length; index++) {
    const point = orderedPoints[index];
    const previous = orderedPoints[index - 1];
    const last = index === orderedPoints.length - 1;
    const setEnded = Number.isInteger(point.setNumber)
      && Number.isInteger(previous?.setNumber)
      && point.setNumber > previous.setNumber;
    // "games(points)" after the point: a game just ended when the new game
    // starts at 0-0. Won by the receiver outside a tiebreak, that's a break.
    const gameEnded = /\(0-0\)\s*$/.test(String(point.scoreLabel ?? ''));
    const broke = gameEnded && !point.isTiebreak && (point.server === 1 || point.server === 2)
      && point.winner !== point.server;
    const importance = last && matchOver ? 'match' : setEnded ? 'set' : broke ? 'break' : 'normal';
    const endedBy = point.endedBy === 'winner' || point.endedBy === 'error' ? point.endedBy : null;
    // Gestures the players really made (read from the recording) always win:
    // they replace the inferred reaction for that player at that point.
    const recorded = new Map();
    for (const gesture of Array.isArray(point.recordedGestures) ? point.recordedGestures : []) {
      const type = dmoGestureType(gesture?.type);
      if ((gesture?.player === 1 || gesture?.player === 2) && type && !recorded.has(gesture.player)) {
        recorded.set(gesture.player, {
          type,
          frame: Number.isFinite(gesture.frame) ? gesture.frame : point.frame,
        });
      }
    }
    for (const [player, gesture] of recorded) {
      const characterStyles = getDmoCharacterGestures(characters[player - 1]);
      events.push({
        frame: gesture.frame,
        player,
        type: gesture.type,
        style: characterStyles[gesture.type] ?? null,
        recorded: true,
      });
    }
    for (const gesture of chooseDmoPointGestures({
      winner: point.winner,
      server: point.server,
      importance,
      rallyHits: Number.isFinite(point.rallyHits) ? point.rallyHits : 0,
      endedBy,
      tiebreak: Boolean(point.isTiebreak),
      // The set the final point was played in (setNumber counts the set after it).
      decidingSet: last && matchOver && decidingSetPlayed(previous?.setNumber ?? point.setNumber, bestOf),
      doubleFault: point.faults >= 2,
    })) {
      if (recorded.has(gesture.player)) continue;
      const characterStyles = getDmoCharacterGestures(characters[gesture.player - 1]);
      events.push({
        frame: point.frame,
        player: gesture.player,
        type: gesture.type,
        style: characterStyles[gesture.type] ?? null,
      });
    }
  }
  events.sort((a, b) => a.frame - b.frame);
  // Each player's gestures of one type take turns through that type's
  // animations: the first fist pump plays the first, the next the second...
  // Fixed by order, so every viewer (and every rewatch) sees the same thing.
  const turns = new Map();
  for (const event of events) {
    const key = `${event.player}:${event.type}`;
    const turn = turns.get(key) ?? 0;
    event.variant = turn;
    turns.set(key, turn + 1);
  }
  return events;
}

function decidingSetPlayed(set, bestOf) {
  if (!Number.isInteger(set)) return false;
  return Number.isInteger(bestOf) && bestOf > 0 ? set >= bestOf : set >= 3;
}

function smoothstep(value, edge0, edge1) {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Resolve the newest selected gesture still playing at a court frame. */
export function resolveDmoGesturePlayback(events, player, frame, frameRate, clips) {
  if (!Array.isArray(events) || !Number.isFinite(frame) || !Number.isFinite(frameRate) || frameRate <= 0) {
    return null;
  }
  let low = 0;
  let high = events.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (events[middle].frame <= frame) low = middle + 1;
    else high = middle;
  }
  for (let index = low - 1; index >= 0; index--) {
    const event = events[index];
    if (event.player !== player) continue;
    const entry = clips?.[event.type];
    const set = Array.isArray(entry) ? entry : entry ? [entry] : [];
    if (!set.length) continue;
    const variant = (Number.isInteger(event.variant) ? event.variant : 0) % set.length;
    const duration = set[variant]?.duration;
    if (!Number.isFinite(duration) || duration <= 0) continue;
    const time = (frame - event.frame) / frameRate;
    if (time < 0 || time >= duration) continue;
    const fadeIn = smoothstep(time, 0, 0.14);
    const fadeOut = 1 - smoothstep(time, Math.max(0.1, duration - 0.28), duration);
    return { type: event.type, variant, time, weight: fadeIn * fadeOut };
  }
  return null;
}

/** The longest the court will hold a point's end for gestures, in seconds. */
export const DMO_GESTURE_DWELL_MAX_SECONDS = 3.5;

function gestureClip(clips, type, variant) {
  const entry = clips?.[type];
  const set = Array.isArray(entry) ? entry : entry ? [entry] : [];
  if (!set.length) return null;
  const clip = set[(Number.isInteger(variant) ? variant : 0) % set.length];
  return Number.isFinite(clip?.duration) && clip.duration > 0 ? clip : null;
}

/**
 * The first point end in (fromFrame, toFrame] where a player has a gesture to
 * play, and how long to hold there. Players gesture standing still, as in the
 * game, instead of over their walk back to position: the court pauses on
 * that frame for the longest gesture (at most DMO_GESTURE_DWELL_MAX_SECONDS).
 *
 * @param {readonly { frame: number, player: 1 | 2, type: string, variant?: number }[]} events  sorted by frame
 * @param {(player: 1 | 2) => Record<string, { duration: number } | readonly { duration: number }[]> | undefined} clipsFor
 */
export function findDmoGestureDwell(events, fromFrame, toFrame, clipsFor) {
  if (!Array.isArray(events) || !Number.isFinite(fromFrame) || !Number.isFinite(toFrame) || toFrame <= fromFrame) {
    return null;
  }
  let low = 0;
  let high = events.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (events[middle].frame <= fromFrame) low = middle + 1;
    else high = middle;
  }
  for (let index = low; index < events.length && events[index].frame <= toFrame; index++) {
    const frame = events[index].frame;
    const gestures = [];
    for (let at = index; at < events.length && events[at].frame === frame; at++) {
      const event = events[at];
      const clip = gestureClip(clipsFor(event.player), event.type, event.variant);
      if (clip && !gestures.some((gesture) => gesture.player === event.player)) {
        gestures.push({ player: event.player, type: event.type, variant: event.variant ?? 0, duration: clip.duration });
      }
    }
    if (gestures.length) {
      const seconds = Math.min(DMO_GESTURE_DWELL_MAX_SECONDS, Math.max(...gestures.map((gesture) => gesture.duration)));
      return { frame, seconds, gestures };
    }
    while (index + 1 < events.length && events[index + 1].frame === frame) index++;
  }
  return null;
}

/**
 * A player's gesture `time` seconds into a hold, faded in at the start and
 * out before the gesture (or the hold, if shorter) ends.
 */
export function dmoGestureDuringDwell(dwell, player, time) {
  const gesture = dwell?.gestures?.find((candidate) => candidate.player === player);
  if (!gesture || !Number.isFinite(time) || time < 0) return null;
  const end = Math.min(gesture.duration, dwell.seconds);
  if (time >= end) return null;
  const fadeIn = smoothstep(time, 0, 0.14);
  const fadeOut = 1 - smoothstep(time, Math.max(0.1, end - 0.28), end);
  return { type: gesture.type, variant: gesture.variant, time, weight: fadeIn * fadeOut };
}
