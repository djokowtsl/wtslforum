export type PlayerSeasonHighlights = {
  year: number;
  matches: number;
  wins: number;
  losses: number;
  titles: string[];
  runnerUps: string[];
  finalsReached: number;
  bestRuns: { tournament: string; round: string }[];
};

type ResultRow = {
  tour?: unknown;
  tournament?: unknown;
  event_category?: unknown;
  date?: unknown;
  round?: unknown;
  result?: unknown;
  p1?: unknown;
  p2?: unknown;
  [key: string]: unknown;
};

type DateParts = { year: number; month: number; day: number };

const EMOJI_RE = /[\u{1F000}-\u{1FFFF}\u{2190}-\u{2BFF}\u{2600}-\u{27BF}\uFE0F\u200D]/gu;
const EXHIBITION_RE = /\b(?:exhibition|year\s*end\s+holidays?\s+cup|holidays?\s+cup|christmas\s+cup|xmas\s+cup|six\s+kings\s+slam|mystery\s+cup)\b/i;

function normalizeName(value: unknown): string {
  if (value == null) return '';
  return String(value)
    .replace(/\s+aka\s+.*$/i, '')
    .replace(EMOJI_RE, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function parseDate(value: unknown): DateParts | null {
  const text = String(value ?? '').trim();
  let match = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  let year: number;
  let month: number;
  let day: number;
  if (match) {
    year = Number(match[1]);
    month = Number(match[2]);
    day = Number(match[3]);
  } else {
    match = text.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/);
    if (!match) return null;
    day = Number(match[1]);
    month = Number(match[2]);
    year = Number(match[3]);
  }
  const checked = new Date(Date.UTC(year, month - 1, day));
  if (
    checked.getUTCFullYear() !== year ||
    checked.getUTCMonth() + 1 !== month ||
    checked.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

function dateIsAfter(left: DateParts, right: DateParts): boolean {
  return left.year > right.year
    || (left.year === right.year && left.month > right.month)
    || (left.year === right.year && left.month === right.month && left.day > right.day);
}

function tourIdentity(value: unknown): string | null {
  const valueText = String(value ?? '').trim().toLowerCase();
  if (!valueText) return null;

  const code = valueText.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const aliases: Record<string, string> = {
    te4: 'te4',
    atp: 'te4',
    atp_tour: 'te4',
    atp_characters: 'te4',
    te4_f: 'te4_(f)',
    wta: 'te4_(f)',
    wta_tour: 'te4_(f)',
    female: 'te4_(f)',
    wta_characters: 'te4_(f)',
    te4_cd: 'te4_cd',
    competitive_doubles: 'te4_cd',
    te4_coop: 'te4_coop',
    cooperative_doubles: 'te4_coop',
    coop: 'te4_coop',
    te4_p: 'te4_p',
    created: 'te4_p',
    created_characters: 'te4_p',
  };
  return aliases[code] ?? valueText;
}

function normalizePlayerId(value: unknown): string {
  return value == null ? '' : String(value).trim().toLowerCase();
}

function rowPlayerId(row: ResultRow, side: 'first' | 'second'): string {
  const keys = side === 'first'
    ? ['p1_id', 'p1Id', 'player1_id', 'player1Id', 'player_one_id', 'first_id', 'firstId']
    : ['p2_id', 'p2Id', 'player2_id', 'player2Id', 'player_two_id', 'second_id', 'secondId'];
  for (const key of keys) {
    const id = normalizePlayerId(row[key]);
    if (id) return id;
  }
  return '';
}

function scoreWinnerSide(row: ResultRow): 'first' | 'second' | null {
  const first = normalizeName(row.p1);
  const second = normalizeName(row.p2);
  const score = String(row.result ?? '').replace(/\([^)]*\)/g, '');
  if (!first || !second || /^(scheduled|tbd|pending|to be played)\b/i.test(score.trim())) return null;

  let firstSets = 0;
  let secondSets = 0;
  for (const set of score.matchAll(/(\d+)\s*[-–]\s*(\d+)/g)) {
    const left = Number(set[1]);
    const right = Number(set[2]);
    if (left > right) firstSets += 1;
    else if (right > left) secondSets += 1;
  }
  if (firstSets === secondSets) return null;
  return firstSets > secondSets ? 'first' : 'second';
}

function roundDepth(value: unknown): number {
  const round = String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (/\bsemi(?:final|finals)?\b|\bsf\b/.test(round)) return 6;
  if (/\bquarter(?:final|finals)?\b|\bqf\b/.test(round)) return 5;
  if (/\b(?:round of )?16\b|\br16\b/.test(round)) return 4;
  if (/\b(?:round of )?32\b|\br32\b/.test(round)) return 3;
  if (/\b(?:round of )?64\b|\br64\b/.test(round)) return 2;
  if (/\b(?:round of )?128\b|\br128\b/.test(round)) return 1;
  if (/\b(?:first|1st) round\b/.test(round)) return 1;
  if (/\b(?:second|2nd) round\b/.test(round)) return 2;
  if (/\b(?:third|3rd) round\b/.test(round)) return 3;
  if (/\b(?:fourth|4th) round\b/.test(round)) return 4;
  if (/\bfinal\b|\bfinals\b|\bf\b/.test(round)) return 7;
  return 0;
}

function tournamentLabel(value: unknown): string {
  return String(value ?? 'Unnamed tournament')
    .trim()
    .replace(/^Tennis Elbow 4\s*\([^)]*\)\s*(?:-\s*)?/i, '')
    .replace(/\s+\d{4}$/, '')
    .trim() || 'Unnamed tournament';
}

export function buildPlayerSeasonHighlights(
  results: unknown,
  playerName: string,
  tour: string,
  year = new Date().getUTCFullYear(),
  playerId?: unknown,
): PlayerSeasonHighlights {
  const empty: PlayerSeasonHighlights = {
    year,
    matches: 0,
    wins: 0,
    losses: 0,
    titles: [],
    runnerUps: [],
    finalsReached: 0,
    bestRuns: [],
  };
  const player = normalizeName(playerName);
  if (!player || !Array.isArray(results)) return empty;

  const requestedTour = tourIdentity(tour);
  const requestedPlayerId = normalizePlayerId(playerId);
  if (!requestedTour) return empty;
  const today = new Date();
  const todayParts = { year: today.getUTCFullYear(), month: today.getUTCMonth() + 1, day: today.getUTCDate() };
  const tournaments = new Map<string, {
    tournament: string;
    bestRound: string;
    bestDepth: number;
    wins: number;
    champion: boolean;
    runnerUp: boolean;
  }>();
  let wins = 0;
  let losses = 0;
  const seen = new Set<string>();

  for (const value of results) {
    if (!value || typeof value !== 'object') continue;
    const row = value as ResultRow;
    if (tourIdentity(row.tour) !== requestedTour) continue;
    const date = parseDate(row.date);
    if (!date || date.year !== year || dateIsAfter(date, todayParts)) continue;
    const eventName = String(row.tournament ?? '');
    if (
      String(row.event_category ?? '').toLowerCase().includes('exhibition')
      || EXHIBITION_RE.test(eventName)
    ) {
      continue;
    }

    const first = normalizeName(row.p1);
    const second = normalizeName(row.p2);
    if (!first || !second) continue;
    const firstId = rowPlayerId(row, 'first');
    const secondId = rowPlayerId(row, 'second');
    let playerSide: 'first' | 'second' | null = null;
    if (requestedPlayerId && (firstId || secondId)) {
      if (firstId === requestedPlayerId) playerSide = 'first';
      else if (secondId === requestedPlayerId) playerSide = 'second';
    } else if (first === player && second !== player) {
      playerSide = 'first';
    } else if (second === player && first !== player) {
      playerSide = 'second';
    }
    if (!playerSide) continue;
    const winnerSide = scoreWinnerSide(row);
    if (!winnerSide) continue;

    const dedupeKey = [
      date.year, date.month, date.day, requestedTour, eventName, String(row.round ?? ''),
      firstId || first, secondId || second, String(row.result ?? ''),
    ].join('|');
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const playerWon = winnerSide === playerSide;
    if (playerWon) wins += 1;
    else losses += 1;

    if (/losers|consolation/i.test(String(row.round ?? ''))) continue;

    const label = tournamentLabel(eventName);
    const key = eventName.trim().toLowerCase() || label.toLowerCase();
    const round = String(row.round ?? 'Completed match').trim() || 'Completed match';
    const depth = roundDepth(row.round);
    const run = tournaments.get(key) ?? {
      tournament: label,
      bestRound: round,
      bestDepth: depth,
      wins: 0,
      champion: false,
      runnerUp: false,
    };
    run.wins += Number(playerWon);
    if (depth > run.bestDepth) {
      run.bestDepth = depth;
      run.bestRound = round;
    }
    if (depth === 7) {
      if (playerWon) run.champion = true;
      else run.runnerUp = true;
    }
    tournaments.set(key, run);
  }

  const runs = [...tournaments.values()];
  const titles = runs.filter((run) => run.champion).map((run) => run.tournament).sort((a, b) => a.localeCompare(b));
  const runnerUps = runs.filter((run) => run.runnerUp && !run.champion).map((run) => run.tournament).sort((a, b) => a.localeCompare(b));
  const bestRuns = [...runs]
    .sort((a, b) => b.bestDepth - a.bestDepth || Number(b.champion) - Number(a.champion) || b.wins - a.wins || a.tournament.localeCompare(b.tournament))
    .slice(0, 4)
    .map(({ tournament, bestRound }) => ({ tournament, round: bestRound }));

  return {
    year,
    matches: wins + losses,
    wins,
    losses,
    titles,
    runnerUps,
    finalsReached: titles.length + runnerUps.length,
    bestRuns,
  };
}