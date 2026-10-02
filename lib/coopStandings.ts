export const COOP_STANDINGS_URL =
  'https://www.playwtsl.com/TE4/pages/leaderboards.php?tour=TE4_Coop';

export type CoopStanding = {
  position: number;
  teamName: string;
  players: string[];
  matchesPlayed: number;
  matchRecord: string;
  matchWinPercent: number | null;
  setsRecord: string;
  setsWinPercent: number | null;
  gamesRecord: string;
  gamesWinPercent: number | null;
};

function decodeHtml(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 10)),
    )
    .replace(/&(amp|quot|apos|lt|gt|nbsp);/gi, (entity, name: string) => {
      const decoded: Record<string, string> = {
        amp: '&',
        quot: '"',
        apos: "'",
        lt: '<',
        gt: '>',
        nbsp: ' ',
      };
      return decoded[name.toLowerCase()] ?? entity;
    });
}

function cellText(html: string): string {
  return decodeHtml(
    html
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]*>/g, ' '),
  ).replace(/\s+/g, ' ').trim();
}

function numericCell(value: string): number | null {
  const number = Number(cellText(value).replace(/%/g, '').trim());
  return Number.isFinite(number) ? number : null;
}

export function parseCoopStandings(html: string): CoopStanding[] {
  const heading = html.search(/<h2\b[^>]*>\s*Coop\s+Leaderboard\s*<\/h2>/i);
  if (heading < 0) throw new Error('Official COOP standings heading was not found');

  const body = html
    .slice(heading)
    .match(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/i)?.[1];
  if (!body) throw new Error('Official COOP standings table was not found');

  const teams = [...body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map(([, row]) => [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)]
      .map(([, cell]) => cell))
    .filter((cells) => cells.length >= 11)
    .flatMap((cells) => {
      const teamName = cellText(cells[1]);
      const players = cellText(cells[2]).split(/\s*\/\s*/).map((player) => player.trim()).filter(Boolean);
      const matchesPlayed = numericCell(cells[3]);
      if (!teamName || matchesPlayed === null) return [];

      return [{
        teamName,
        players,
        matchesPlayed: Math.max(0, Math.trunc(matchesPlayed)),
        matchRecord: cellText(cells[4]),
        matchWinPercent: numericCell(cells[5]),
        setsRecord: cellText(cells[6]),
        setsWinPercent: numericCell(cells[7]),
        gamesRecord: cellText(cells[8]),
        gamesWinPercent: numericCell(cells[9]),
      }];
    });

  if (teams.length === 0) throw new Error('Official COOP standings contained no teams');
  return teams.map((team, index) => ({ position: index + 1, ...team }));
}

export async function fetchCoopStandings(): Promise<CoopStanding[]> {
  const response = await fetch(COOP_STANDINGS_URL, {
    next: { revalidate: 300 },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) {
    throw new Error(`Official COOP standings request failed: ${response.status}`);
  }
  return parseCoopStandings(await response.text());
}