export const FORUM_MAINTENANCE_START_UTC: number;
export const FORUM_MAINTENANCE_END_UTC: number;
export const COMMENTARY_RESTRICTION_END_UTC: number;
export const COMMENTARY_MAINTENANCE_MESSAGE: string;

export function isForumMaintenanceActive(now?: number): boolean;
export function isCommentaryRestrictionActive(now?: number): boolean;
export function isAllowedCommentaryMatch(input: {
  replayId?: string | number | null;
  names?: readonly string[] | null;
  player1?: string | null;
  player2?: string | null;
  tournament?: string | null;
}): boolean;
