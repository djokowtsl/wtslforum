export type ParsedLiveMatch = {
  name: string;
  tagline: string;
  score: string;
  court: string;
  mode: string;
  bestOf: 1 | 3 | 5;
  tourHint: 'TE4' | 'TE4_(F)' | null;
  inGameElo1: number | null;
  inGameElo2: number | null;
};

type PollToken = { value: string; quoted: boolean };

/**
 * Resolve an already-normalized live-feed name against normalized WTSL player
 * names. TE4 shortens some account names to an initial plus surname (for
 * example, "F.Franchicha"); accept that form only when it identifies one
 * ranked player in the current tour.
 */
export function resolveLivePlayer<T>(
  normalizedName: string,
  playersByNormalizedName: ReadonlyMap<string, T>,
): T | null {
  const exactMatch = playersByNormalizedName.get(normalizedName);
  if (exactMatch !== undefined) return exactMatch;

  const abbreviation = normalizedName.match(
    /^([\p{L}\p{N}])(?:\.|\s+)\s*([\p{L}\p{N}][\p{L}\p{N}'’_-]*)$/u,
  );
  if (!abbreviation) return null;

  const [, firstInitial, surname] = abbreviation;
  let uniqueMatch: T | null = null;
  for (const [canonicalName, player] of playersByNormalizedName) {
    const parts = canonicalName.split(/\s+/);
    if (
      parts.length !== 2
      || !parts[0].startsWith(firstInitial)
      || parts[1] !== surname
    ) {
      continue;
    }
    if (uniqueMatch !== null) return null;
    uniqueMatch = player;
  }
  return uniqueMatch;
}

function tokenizePollText(text: string): PollToken[] {
  const tokens: PollToken[] = [];
  for (const match of text.matchAll(/"([^"]*)"|(\S+)/g)) {
    const quotedValue = match[1];
    tokens.push({
      value: quotedValue !== undefined ? quotedValue : match[2],
      quoted: quotedValue !== undefined && quotedValue !== '',
    });
  }
  return tokens;
}

function splitPollBlocks(tokens: PollToken[]): PollToken[][] {
  const blocks: PollToken[][] = [];
  let current: PollToken[] = [];
  const hex = /^[0-9a-f]{2,6}$/i;
  const ipv4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    const next = tokens[i + 1];
    const beginsEntry = !token.quoted && !!next && !next.quoted && hex.test(next.value)
      && (token.value === '0' || ipv4.test(token.value));
    if (beginsEntry) {
      if (current.length) blocks.push(current);
      current = [token];
    } else {
      current.push(token);
    }
  }
  if (current.length) blocks.push(current);
  return blocks;
}

function fromHex(value: string): number {
  const parsed = Number.parseInt(value, 16);
  return Number.isFinite(parsed) ? parsed : 0;
}

function playerEloFromHex(value: string | undefined): number | null {
  const elo = fromHex(value ?? '');
  return elo > 0 ? elo : null;
}

function decodeSettings(gameInfoHex: string) {
  const gameInfo = fromHex(gameInfoHex);
  const playerConfig = (gameInfo >> 2) & 7;
  const setCode = (gameInfo >> 5) & 3;
  const mode = playerConfig === 0
    ? 'Singles'
    : playerConfig === 2
      ? 'Competitive Doubles'
      : playerConfig === 3
        ? 'Cooperative Doubles'
        : `Mode ${playerConfig}`;
  const bestOf: 1 | 3 | 5 = setCode === 2 ? 3 : setCode === 3 ? 5 : 1;
  return { mode, bestOf };
}

/** Mirrors the bot's server-list block parser and requires the exact WTSL host tag. */
export function parseLiveWtslMatches(pollText: string): ParsedLiveMatch[] {
  if (!pollText.trim()) return [];
  const output: ParsedLiveMatch[] = [];
  const seen = new Set<string>();

  for (const block of splitPollBlocks(tokenizePollText(pollText))) {
    if (block.length < 14) continue;
    let index = 0;
    index += 2; // address and port
    const name = block[index++];
    if (!name?.quoted) continue;
    const gameInfo = block[index++]?.value;
    index += 1; // max ping
    const inGameElo1 = playerEloFromHex(block[index++]?.value);
    index += 1; // game count
    const tagline = block[index++];
    const score = block[index++];
    const inGameElo2 = playerEloFromHex(block[index++]?.value);
    index += 2; // give-up count, reputation
    const court = block[index++];
    if (!gameInfo || !tagline?.quoted || !score?.quoted || !court?.quoted) continue;
    if (!tagline.value.toUpperCase().includes('XKT(WTSL)')) continue;
    if (!/\bvs\b/i.test(name.value) || score.value.trim() === '...') continue;

    const settings = decodeSettings(gameInfo);
    const tourHint: ParsedLiveMatch['tourHint'] = /(?:\bWTA\s*-\s*XKT\(WTSL\)|TE4[_\s]?\(?F\)?)/i.test(tagline.value)
      ? 'TE4_(F)'
      : /\bATP\b/i.test(tagline.value) ? 'TE4' : null;
    const match = {
      name: name.value.trim(),
      tagline: tagline.value,
      score: score.value.trim(),
      court: court.value.replace(/^\s*\d+\s+/, '').trim() || '—',
      mode: settings.mode,
      bestOf: settings.bestOf,
      tourHint,
      inGameElo1,
      inGameElo2,
    };
    const key = [match.name.toLowerCase(), match.court.toLowerCase(), match.tagline, match.score].join('|');
    if (!seen.has(key)) {
      seen.add(key);
      output.push(match);
    }
  }
  return output;
}

export function formatLivePlayerElos(
  inGameElo: number | null | undefined,
  tourElo: number | null | undefined,
): string | null {
  const ratings: string[] = [];
  if (typeof inGameElo === 'number' && Number.isFinite(inGameElo) && inGameElo > 0) {
    ratings.push(`Game: ${inGameElo}`);
  }
  if (typeof tourElo === 'number' && Number.isFinite(tourElo) && tourElo > 0) {
    ratings.push(`Tour: ${tourElo}`);
  }
  return ratings.length > 0 ? `[${ratings.join(' | ')}]` : null;
}

function bestOfThree(setProbability: number) {
  return 3 * setProbability ** 2 - 2 * setProbability ** 3;
}

function invertBestOfThree(matchProbability: number) {
  let low = 0;
  let high = 1;
  for (let i = 0; i < 64; i += 1) {
    const middle = (low + high) / 2;
    if (bestOfThree(middle) < matchProbability) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

function capPercent(value: number) {
  return Math.max(1, Math.min(99, Math.round(value * 100)));
}

/**
 * The official H2H page is the source of the supplied Elo/H2H model. Its bar is
 * the best-of-three result; invert that result to apply the same set probability
 * to best-of-one or best-of-five live matches.
 */
export function adjustOfficialH2HPercent(percent: number, bestOf: 1 | 3 | 5): number | null {
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) return null;
  if (bestOf === 3) return Math.max(1, Math.min(99, Math.round(percent)));

  const setProbability = invertBestOfThree(percent / 100);
  if (bestOf === 1) return capPercent(setProbability);
  const bestOfFive = setProbability ** 3
    * (1 + 3 * (1 - setProbability) + 6 * (1 - setProbability) ** 2);
  return capPercent(bestOfFive);
}

/** Uses the pair's historical win share; an empty 0–0 record is neutral at 50%. */
export function h2hRecordWinPercent(record: { firstWins: number; secondWins: number }): number {
  const total = record.firstWins + record.secondWins;
  return total > 0 ? (record.firstWins / total) * 100 : 50;
}

function h2hCellText(value: string): string {
  return value
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code: string) => {
      const point = Number(code);
      return point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : ' ';
    })
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => {
      const point = Number.parseInt(code, 16);
      return point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : ' ';
    })
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Read completed pair-specific meetings from the official WTSL H2H page.
 * A page that did not select both requested player IDs is not trusted.
 */
export function readOfficialH2HRecord(
  html: string,
  firstPlayerId: string | number,
  firstPlayerName: string,
  secondPlayerId: string | number,
  secondPlayerName: string,
): { firstWins: number; secondWins: number; matches: number } | null {
  const firstId = String(firstPlayerId).trim();
  const secondId = String(secondPlayerId).trim();
  if (!firstId || !secondId || firstId === secondId) return null;

  const selectedIds = new Set<string>();
  for (const [, attributes] of html.matchAll(/<option\b([^>]*)>/gi)) {
    if (!/\bselected(?:\s|=|\/|$)/i.test(attributes)) continue;
    const value = attributes.match(/\bvalue\s*=\s*(["'])(.*?)\1/i)?.[2];
    if (value) selectedIds.add(h2hCellText(value));
  }
  if (!selectedIds.has(firstId) || !selectedIds.has(secondId)) return null;

  const resultsTable = [...html.matchAll(/<table\b([^>]*)>([\s\S]*?)<\/table>/gi)]
    .find(([, attributes]) => {
      const className = attributes.match(/\bclass\s*=\s*(["'])(.*?)\1/i)?.[2] ?? '';
      return className.split(/\s+/).includes('results-table');
    })?.[2];
  if (!resultsTable) return { firstWins: 0, secondWins: 0, matches: 0 };

  const firstName = h2hCellText(firstPlayerName).toLocaleLowerCase();
  const secondName = h2hCellText(secondPlayerName).toLocaleLowerCase();
  let firstWins = 0;
  let secondWins = 0;
  for (const [row] of resultsTable.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)]
      .map(([, cell]) => cell);
    const winnerCell = cells.length >= 7 ? cells[5] : cells.length >= 6 ? cells[4] : null;
    const scoreCell = cells.length >= 7 ? cells[6] : cells.length >= 6 ? cells[5] : null;
    if (!winnerCell || !scoreCell) continue;

    const score = h2hCellText(scoreCell);
    if (
      !/\d+\s*[-–]\s*\d+/.test(score)
      || /\b(?:scheduled|pending|live|tbd|to be played|walkover|walk-over|w\/o|default|cancelled|canceled|abandoned)\b/i.test(score)
    ) {
      continue;
    }

    const winnerLink = winnerCell.match(/<a\b[^>]*href\s*=\s*(["'])(.*?)\1/i)?.[2]
      ?.replace(/&amp;/gi, '&');
    let winnerId: string | null = null;
    if (winnerLink) {
      try {
        winnerId = new URL(winnerLink, 'https://www.playwtsl.com/TE4/pages/h2h.php')
          .searchParams.get('player');
      } catch {
        winnerId = null;
      }
    }

    if (winnerId) {
      if (winnerId === firstId) firstWins++;
      else if (winnerId === secondId) secondWins++;
      continue;
    }

    const winnerName = h2hCellText(winnerCell).toLocaleLowerCase();
    if (winnerName === firstName) firstWins++;
    else if (winnerName === secondName) secondWins++;
  }

  return { firstWins, secondWins, matches: firstWins + secondWins };
}

export function readOfficialH2HPercent(html: string): number | null {
  const element = html.match(/<div\b(?=[^>]*\bclass\s*=\s*["'][^"']*\bh2h-winfill\b[^"']*["'])[^>]*>/i);
  if (!element) return null;
  const openingTag = element[0];
  const width = openingTag.match(/\bwidth\s*:\s*(\d+(?:\.\d+)?)\s*%/i);
  const valueStart = (element.index ?? 0) + openingTag.length;
  const valueEnd = html.indexOf('</div>', valueStart);
  const inner = valueEnd >= 0 ? html.slice(valueStart, valueEnd).replace(/<[^>]*>/g, ' ') : '';
  const displayed = inner.match(/(\d+(?:\.\d+)?)\s*%/);
  const percent = Number(width?.[1] ?? displayed?.[1]);
  return Number.isFinite(percent) && percent >= 0 && percent <= 100 ? percent : null;
}
