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
  return events.sort((a, b) => a.frame - b.frame);
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
    const duration = clips?.[event.type]?.duration;
    if (!Number.isFinite(duration) || duration <= 0) continue;
    const time = (frame - event.frame) / frameRate;
    if (time < 0 || time >= duration) continue;
    const fadeIn = smoothstep(time, 0, 0.14);
    const fadeOut = 1 - smoothstep(time, Math.max(0.1, duration - 0.28), duration);
    return { type: event.type, time, weight: fadeIn * fadeOut };
  }
  return null;
}
