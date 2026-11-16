import { chooseDmoPointGestures, getDmoCharacterGestures } from './dmoCharacterGestures.mjs';

/**
 * Build deterministic, point-anchored reactions. Ordinary points stay quiet;
 * the existing helper selects only long rallies and set/match milestones.
 */
export function buildDmoPointGestureEvents(
  points,
  { characters = [null, null], matchOver = false } = {},
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
    const setEnded = Number.isInteger(point.setNumber)
      && Number.isInteger(previous?.setNumber)
      && point.setNumber > previous.setNumber;
    const importance = index === orderedPoints.length - 1 && matchOver
      ? 'match'
      : setEnded ? 'set' : 'normal';
    const endedBy = point.endedBy === 'error' || point.faults >= 2
      ? 'error'
      : point.endedBy === 'winner' ? 'winner' : null;
    for (const gesture of chooseDmoPointGestures({
      winner: point.winner,
      importance,
      rallyHits: Number.isFinite(point.rallyHits) ? point.rallyHits : 0,
      endedBy,
    })) {
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
