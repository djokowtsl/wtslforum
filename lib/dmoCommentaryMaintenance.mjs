export const FORUM_MAINTENANCE_START_UTC = Date.parse('2026-11-14T01:00:00Z');
export const FORUM_MAINTENANCE_END_UTC = Date.parse('2026-11-14T08:00:00Z');
export const COMMENTARY_RESTRICTION_END_UTC = FORUM_MAINTENANCE_END_UTC;

export const COMMENTARY_MAINTENANCE_MESSAGE =
  'Match commentary is temporarily unavailable until 08:00 GMT on Saturday 14 November.';

export function isForumMaintenanceActive(now = Date.now()) {
  return now >= FORUM_MAINTENANCE_START_UTC && now < FORUM_MAINTENANCE_END_UTC;
}

export function isCommentaryRestrictionActive() {
  // Commentary has reopened independently of the scheduled Forum outage.
  return false;
}

function normalized(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function isAllowedCommentaryMatch({
  replayId,
  names,
  player1,
  player2,
  tournament,
}) {
  if (replayId != null && String(replayId) !== '23') return false;

  const players = Array.isArray(names) ? names : [player1, player2];
  if (players.length !== 2) return false;
  const normalizedPlayers = players.map(normalized);
  const hasGifu = normalizedPlayers.some((name) => name === 'gifu' || name === 'gifuko');
  const hasTinkerman = normalizedPlayers.some(
    (name) => name === 'tinkerman' || name === 'thetinkerman',
  );
  const atRolandGarros = normalized(tournament).includes('rolandgarros');
  return hasGifu && hasTinkerman && atRolandGarros;
}
