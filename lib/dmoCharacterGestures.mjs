import gestureData from '../public/dmo-character-gestures.json' with { type: 'json' };
import { DMO_GESTURE_TYPES, dmoGestureNameKey } from './dmoGestureTypes.mjs';

export { DMO_GESTURES, DMO_GESTURE_TYPES, dmoGestureType } from './dmoGestureTypes.mjs';

/**
 * A character's gesture styles from the XKT(WTSL) mod, e.g.
 * { CheerFist: 7, RagingFist: 4 }. Types missing from the result use the
 * game's default style. Unknown characters get {}.
 */
export function getDmoCharacterGestures(name) {
  const key = dmoGestureNameKey(name);
  return { ...(key ? gestureData.characters[key]?.gestures : undefined) };
}

/**
 * Which gestures to show after a point when the recording doesn't say.
 * Reactions stay rare: only big moments, long rallies, and the match end.
 *
 * @param {{
 *   winner: 1 | 2,
 *   importance?: 'normal' | 'break' | 'set' | 'match',
 *   rallyHits?: number,
 *   endedBy?: 'winner' | 'error' | null,
 * }} point
 * @returns {Array<{ player: 1 | 2, type: string }>}
 */
export function chooseDmoPointGestures({ winner, importance = 'normal', rallyHits = 0, endedBy = null }) {
  if (winner !== 1 && winner !== 2) return [];
  const loser = winner === 1 ? 2 : 1;
  const gestures = [];
  const add = (player, type) => { if (DMO_GESTURE_TYPES.includes(type)) gestures.push({ player, type }); };
  if (importance === 'match') {
    add(winner, 'Victory');
    add(loser, 'Applause');
  } else if (importance === 'set') {
    add(winner, 'RagingFist');
    if (endedBy === 'error') add(loser, 'Stupid');
  } else if (importance === 'break') {
    add(winner, 'CheerFist');
    if (endedBy === 'error') add(loser, 'Stupid');
  } else if (rallyHits >= 12) {
    add(winner, 'CheerFist');
    if (endedBy === 'winner') add(loser, 'Applause');
  }
  return gestures;
}
