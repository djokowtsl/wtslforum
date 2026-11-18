export const NATIVE_MOTION_CATALOG_SHA256 =
  '18e4e987598b0012b8ac8f93c31cac1c372da884e6789848e4ca4b6f3be25aa5';

// Keep gesture clips on their own immutable catalog. Stroke consumers and
// their existing cache key continue to use NATIVE_MOTION_CATALOG_SHA256.
export const NATIVE_MOTION_GESTURE_CATALOG_SHA256 =
  'a4e83a7057566faa941c73ad37dfd00419e7090fde89bb3b88bb8eef80605a29';

/**
 * Stroke-catalog animations the court plays for special moments, whatever
 * the player's own choices (more can be added as clips arrive):
 * - 'slide-backhand': a backhand played sliding in (mod "Djokovic Slide",
 *   by Rharm), used when a player slides into a backhand;
 * - 'stretch-slice-forehand': a forehand slice (mod "Djokovic forehand
 *   slice"), only for a last-ditch forehand (see LAST_DITCH_* in the court)
 *   when the player has no forehand slice of his own. Not used for ordinary
 *   forehands: players rarely slice them.
 */
export const NATIVE_MOTION_SPECIAL_CLIPS = {
  'slide-backhand': { clipId: 'a2c075e329bf25172543_80477a8d19745e08', sourceHandedness: 'right' },
  'stretch-slice-forehand': { clipId: '0996c83fd2fc9c7639e9_8454ce7fe166591f', sourceHandedness: 'right' },
} as const;
