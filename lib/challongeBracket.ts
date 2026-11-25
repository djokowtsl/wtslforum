const CHALLONGE_BASE =
  'https://91d510368cb4170cd5ac3776.challonge.com';
const CHALLONGE_ID_PATTERN = /^[A-Za-z0-9_-]{1,120}$/;

export function getChallongeTournamentId(officialUrl: string): string | null {
  try {
    const url = new URL(officialUrl);
    if (
      url.protocol !== 'https:' ||
      !['playwtsl.com', 'www.playwtsl.com'].includes(url.hostname.toLowerCase())
    ) {
      return null;
    }

    const tournamentId = url.searchParams.get('tournament')?.trim() ?? '';
    return CHALLONGE_ID_PATTERN.test(tournamentId) ? tournamentId : null;
  } catch {
    return null;
  }
}

export function getChallongeTournamentUrl(officialUrl: string): string | null {
  const tournamentId = getChallongeTournamentId(officialUrl);
  return tournamentId
    ? `${CHALLONGE_BASE}/${encodeURIComponent(tournamentId)}`
    : null;
}
