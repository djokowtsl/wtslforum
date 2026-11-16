/**
 * Tennis Elbow 4's gesture types. The game numbers them 300–309 (its
 * character menu's "Part" ids); each character picks a style for each type,
 * and gesture mods replace those styles with their own animations.
 */
export const DMO_GESTURES = Object.freeze([
  { type: 'ThrowRacket', part: 300, outcome: 'loss', label: 'Throw racket' },
  { type: 'HitRacket', part: 301, outcome: 'loss', label: 'Hit racket' },
  { type: 'Stupid', part: 302, outcome: 'loss', label: 'Frustration' },
  { type: 'Applause', part: 303, outcome: 'loss', label: 'Applause' },
  { type: 'RagingFist', part: 304, outcome: 'win', label: 'Raging fist' },
  { type: 'CheerFist', part: 305, outcome: 'win', label: 'Fist pump' },
  { type: 'CheerJump', part: 306, outcome: 'win', label: 'Jump' },
  { type: 'Sorry', part: 307, outcome: 'win', label: 'Sorry' },
  { type: 'Victory', part: 308, outcome: 'match', label: 'Victory' },
  { type: 'VictoryGreat', part: 309, outcome: 'match', label: 'Big victory' },
]);

export const DMO_GESTURE_TYPES = Object.freeze(DMO_GESTURES.map((gesture) => gesture.type));

const byLowerType = new Map(DMO_GESTURE_TYPES.map((type) => [type.toLowerCase(), type]));
// Folder and bundle names seen in TE4 and gesture mods.
byLowerType.set('throwracquet', 'ThrowRacket');

/** "cheerfist", "CheerFist" or "throwracquet" → the canonical type, or null. */
export function dmoGestureType(value) {
  return byLowerType.get(String(value ?? '').replace(/[^a-z]/gi, '').toLowerCase()) ?? null;
}

/** The same character key the Forum uses everywhere ("Novak Djokovic (ATP) v2" → "novak djokovic"). */
export function dmoGestureNameKey(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('en-GB')
    .replace(/\b(?:atp|wta|v\d+)\b/gu, ' ')
    .match(/[\p{L}\p{N}]+/gu)
    ?.join(' ') ?? '';
}
