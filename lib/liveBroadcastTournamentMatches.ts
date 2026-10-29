import { normalizeLivePlayerName, sameLiveMatch } from '@/lib/liveBroadcast';

export type OngoingTournamentMatch = {
  tournamentId: string;
  tour: string;
  first_name: string;
  second_name: string;
};

export function isFreshTournamentMatchSnapshot(
  checkedAt: string,
  now = Date.now(),
) {
  const checkedAtMs = Date.parse(checkedAt);
  const ageMs = now - checkedAtMs;
  return Number.isFinite(checkedAtMs) && ageMs >= 0 && ageMs <= 30 * 60 * 1000;
}

type Fixture = {
  tour?: string;
  tournament_id?: string | number | null;
  first_name?: string;
  second_name?: string;
};

type Tournament = {
  tour: string;
  status: string;
  officialUrl: string;
};

function tournamentIdFromOfficialUrl(value: string) {
  try {
    return new URL(value).searchParams.get('tournament')?.trim() || null;
  } catch {
    return null;
  }
}

function decodeXml(value: string) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, code) => {
    const normalized = String(code).toLowerCase();
    if (normalized === 'amp') return '&';
    if (normalized === 'lt') return '<';
    if (normalized === 'gt') return '>';
    if (normalized === 'quot') return '"';
    if (normalized === 'apos') return "'";
    if (normalized === 'nbsp') return ' ';
    const numeric = normalized.startsWith('#x')
      ? Number.parseInt(normalized.slice(2), 16)
      : Number.parseInt(normalized.slice(1), 10);
    try {
      return Number.isFinite(numeric) ? String.fromCodePoint(numeric) : entity;
    } catch {
      return entity;
    }
  });
}

function cleanChallongePlayerName(value: string) {
  return decodeXml(value.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\(\d+\)\s*/, '')
    .replace(/\s+\([^()]*\)\s*$/, '')
    .trim();
}

export function parseChallongeSvgUrl(html: string, officialPageUrl: string): string | null {
  for (const iframe of html.matchAll(/<iframe\b[^>]*\bsrc\s*=\s*(["'])([^"']+)\1/gi)) {
    try {
      const moduleUrl = new URL(decodeXml(iframe[2]).trim(), officialPageUrl);
      const hostname = moduleUrl.hostname.toLowerCase();
      if (
        !['http:', 'https:'].includes(moduleUrl.protocol)
        || (hostname !== 'challonge.com' && !hostname.endsWith('.challonge.com'))
        || !moduleUrl.pathname.replace(/\/+$/, '').endsWith('/module')
      ) {
        continue;
      }
      moduleUrl.pathname = moduleUrl.pathname.replace(/\/module\/?$/, '.svg');
      moduleUrl.search = '';
      moduleUrl.hash = '';
      return moduleUrl.toString();
    } catch {
      continue;
    }
  }
  return null;
}

export function parseChallongeOpenMatches(
  svg: string,
  tournamentId: string,
  tour: string,
): OngoingTournamentMatch[] {
  const matches: OngoingTournamentMatch[] = [];
  const matchGroups = /<g\b(?=[^>]*\bclass\s*=\s*(["'])[^"']*\bmatch\b[^"']*-open(?=[\s"'])[^"']*\1)(?=[^>]*\bdata-match-id\s*=\s*(["'])[^"']+\2)[^>]*>([\s\S]*?)<\/g>/gi;

  for (const group of svg.matchAll(matchGroups)) {
    const players: string[] = [];
    const playerNodes = /<svg\b(?=[^>]*\bclass\s*=\s*(["'])[^"']*\bmatch--player\b[^"']*\1)[^>]*>([\s\S]*?)<\/svg>/gi;
    for (const player of group[3].matchAll(playerNodes)) {
      const title = player[2].match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? player[2];
      const name = cleanChallongePlayerName(title);
      if (name) players.push(name);
    }
    if (players.length !== 2) continue;
    if (players.some((name) => /^(?:tba|tbc|tbd|bye|to be announced|to be confirmed)$/i.test(name))) {
      continue;
    }
    matches.push({
      tournamentId,
      tour,
      first_name: players[0],
      second_name: players[1],
    });
  }
  return matches;
}

async function loadTournamentDrawMatches(
  tournament: Tournament,
  tournamentId: string,
  fetcher: typeof fetch,
): Promise<OngoingTournamentMatch[]> {
  try {
    const officialPage = new URL(tournament.officialUrl);
    if (!['playwtsl.com', 'www.playwtsl.com'].includes(officialPage.hostname.toLowerCase())) {
      return [];
    }
    const headers = {
      'user-agent': 'WTSL-Community-Bridge/1.0',
      accept: 'text/html,application/xhtml+xml,image/svg+xml,*/*;q=0.8',
    };
    const pageResponse = await fetcher(officialPage, {
      cache: 'no-store',
      headers,
      signal: AbortSignal.timeout(8_000),
    });
    if (!pageResponse.ok) return [];
    const svgUrl = parseChallongeSvgUrl(await pageResponse.text(), officialPage.toString());
    if (!svgUrl) return [];
    const drawResponse = await fetcher(svgUrl, {
      cache: 'no-store',
      headers,
      signal: AbortSignal.timeout(8_000),
    });
    if (!drawResponse.ok) return [];
    return parseChallongeOpenMatches(
      await drawResponse.text(),
      tournamentId,
      tournament.tour,
    );
  } catch {
    return [];
  }
}

export async function loadOngoingTournamentMatches(
  fixtures: Fixture[],
  tournaments: Tournament[],
  fetcher: typeof fetch = fetch,
): Promise<OngoingTournamentMatch[]> {
  const ongoing = tournaments.flatMap((tournament) => {
    if (tournament.status.trim().toLowerCase() !== 'ongoing') return [];
    const tournamentId = tournamentIdFromOfficialUrl(tournament.officialUrl);
    return tournamentId ? [{ tournament, tournamentId }] : [];
  });
  if (!ongoing.length) return [];

  const ongoingIds = new Set(
    ongoing.map(({ tournament, tournamentId }) => `${tournament.tour}|${tournamentId}`),
  );
  const fixtureMatches = fixtures.flatMap((fixture) => {
    const tour = String(fixture.tour ?? '').trim();
    const tournamentId = String(fixture.tournament_id ?? '').trim();
    const firstName = String(fixture.first_name ?? '').trim();
    const secondName = String(fixture.second_name ?? '').trim();
    if (
      !ongoingIds.has(`${tour}|${tournamentId}`)
      || !['TE4', 'TE4_(F)'].includes(tour)
      || !firstName
      || !secondName
    ) {
      return [];
    }
    return [{ tournamentId, tour, first_name: firstName, second_name: secondName }];
  });
  const drawMatches = await Promise.all(ongoing.map(({ tournament, tournamentId }) =>
    loadTournamentDrawMatches(tournament, tournamentId, fetcher),
  ));
  const unique = new Map<string, OngoingTournamentMatch>();
  for (const match of [...fixtureMatches, ...drawMatches.flat()]) {
    const pair = [match.first_name, match.second_name].sort();
    unique.set(`${match.tour}|${match.tournamentId}|${pair.join('|')}`, match);
  }
  return [...unique.values()];
}

export function matchesOngoingTournament(
  players: [string, string],
  matches: OngoingTournamentMatch[],
) {
  return matches.some((match) =>
    ['TE4', 'TE4_(F)'].includes(match.tour)
    && sameLiveMatch(players, [match.first_name, match.second_name]),
  );
}

export function findOngoingTournamentMatchInText(
  text: string,
  matches: OngoingTournamentMatch[],
) {
  const normalizedText = normalizeLivePlayerName(text);
  if (!normalizedText) return null;
  const matching = matches.filter((match) => {
    const first = normalizeLivePlayerName(match.first_name);
    const second = normalizeLivePlayerName(match.second_name);
    return first.length >= 3 && second.length >= 3
      && normalizedText.includes(first)
      && normalizedText.includes(second);
  });
  const uniquePairs = new Map<string, OngoingTournamentMatch>();
  for (const match of matching) {
    const pair = [
      normalizeLivePlayerName(match.first_name),
      normalizeLivePlayerName(match.second_name),
    ].sort();
    uniquePairs.set(`${match.tour}|${pair.join('|')}`, match);
  }
  return uniquePairs.size === 1 ? [...uniquePairs.values()][0] : null;
}
