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
 * Every Tennis Elbow situation has its reaction, and the reaction scales
 * with the moment; ordinary short points stay quiet.
 *  - match point: Victory (VictoryGreat after a deciding set); loser Applause
 *  - set won: RagingFist (CheerJump in a tiebreak); loser ThrowRacket when
 *    the set ended on their own error, otherwise HitRacket
 *  - break of serve: CheerFist; loser Stupid on their error, HitRacket
 *    when beaten by a winner
 *  - long rally: CheerFist from 12 shots, RagingFist from 20, CheerJump
 *    from 30; the loser shows frustration when it ended on their error and
 *    applauds a 20+ shot rally ended by a winner
 *  - double fault: the server's Stupid
 *
 * @param {{
 *   winner: 1 | 2,
 *   server?: 1 | 2,
 *   importance?: 'normal' | 'break' | 'set' | 'match',
 *   rallyHits?: number,
 *   endedBy?: 'winner' | 'error' | null,
 *   tiebreak?: boolean,
 *   decidingSet?: boolean,
 *   doubleFault?: boolean,
 * }} point
 * @returns {Array<{ player: 1 | 2, type: string }>}
 */
export function chooseDmoPointGestures({
  winner, server, importance = 'normal', rallyHits = 0, endedBy = null,
  tiebreak = false, decidingSet = false, doubleFault = false,
}) {
  if (winner !== 1 && winner !== 2) return [];
  const loser = winner === 1 ? 2 : 1;
  const error = endedBy === 'error' || doubleFault;
  const chosen = new Map();
  const add = (player, type) => {
    if (DMO_GESTURE_TYPES.includes(type) && !chosen.has(player)) chosen.set(player, type);
  };
  if (importance === 'match') {
    add(winner, decidingSet ? 'VictoryGreat' : 'Victory');
    add(loser, 'Applause');
  } else if (importance === 'set') {
    add(winner, tiebreak ? 'CheerJump' : 'RagingFist');
    add(loser, error ? 'ThrowRacket' : 'HitRacket');
  } else if (importance === 'break') {
    add(winner, 'CheerFist');
    add(loser, error ? 'Stupid' : 'HitRacket');
  }
  if (doubleFault && (server === 1 || server === 2)) add(server, 'Stupid');
  if (rallyHits >= 12) {
    add(winner, rallyHits >= 30 ? 'CheerJump' : rallyHits >= 20 ? 'RagingFist' : 'CheerFist');
    if (endedBy === 'error') add(loser, 'Stupid');
    else if (rallyHits >= 20 && endedBy === 'winner') add(loser, 'Applause');
  }
  return [...chosen].map(([player, type]) => ({ player, type })).sort((a, b) => (
    (a.player === winner ? 0 : 1) - (b.player === winner ? 0 : 1)
  ));
}
