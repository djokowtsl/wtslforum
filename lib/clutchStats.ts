export type OfficialResult = {
  tournamentName: string;
  round: string;
  player1Id: string;
  player2Id: string;
  date: string | null;
  score: string;
};

export type ClutchAggregate = {
  setsWon: number;
  setsLost: number;
  tiebreaksWon: number;
  tiebreaksPlayed: number;
  decidingSetsWon: number;
  decidingSetsPlayed: number;
};

export type OfficialClutchAggregates = {
  byPlayer: Map<string, ClutchAggregate>;
  matchesSeen: number;
  matchesCounted: number;
  duplicatesIgnored: number;
  conflictsIgnored: number;
};

export function normalizeMatchScore(score: string): string {
  return score
    .replace(/\b(?:ret(?:ired)?|walkover)\.?(?=\s|$)/gi, '')
    .replace(/\//g, '-')
    .replace(/[,;]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseSets(score: string): [number, number][] | null {
  const tokens = normalizeMatchScore(score).split(' ').filter(Boolean);
  if (!tokens.length) return null;
  const sets: [number, number][] = [];
  for (const token of tokens) {
    const match = token.replace(/\([^)]*\)/g, '').trim().match(/^(\d+)\s*-\s*(\d+)$/);
    if (!match) return null;
    sets.push([Number(match[1]), Number(match[2])]);
  }
  return sets;
}

function isCompletedSet([first, second]: [number, number]): boolean {
  const high = Math.max(first, second);
  const low = Math.min(first, second);
  return (high >= 6 && high - low >= 2) || (high === 7 && low === 6);
}

function newAggregate(): ClutchAggregate {
  return {
    setsWon: 0,
    setsLost: 0,
    tiebreaksWon: 0,
    tiebreaksPlayed: 0,
    decidingSetsWon: 0,
    decidingSetsPlayed: 0,
  };
}

function matchIdentity(row: OfficialResult): string {
  const players = [row.player1Id, row.player2Id].sort();
  const tournament = row.tournamentName.trim().toLocaleLowerCase();
  const round = row.round.trim().toLocaleLowerCase();
  const date = row.date?.trim() || 'undated';
  return [tournament, round, date, players[0], players[1]].join('\u0000');
}

export type OfficialHeadToHeadRecord = {
  firstWins: number;
  secondWins: number;
  matches: number;
};

/** Counts winner-oriented all-results rows for one player pair, ignoring duplicate and conflicting rows. */
export function computeOfficialHeadToHeadRecord(
  rows: OfficialResult[],
  firstPlayerId: string | number,
  secondPlayerId: string | number,
): OfficialHeadToHeadRecord {
  const firstId = String(firstPlayerId).trim();
  const secondId = String(secondPlayerId).trim();
  if (!firstId || !secondId || firstId === secondId) {
    return { firstWins: 0, secondWins: 0, matches: 0 };
  }

  const unique = new Map<string, OfficialResult | null>();
  for (const row of rows) {
    const player1Id = row.player1Id.trim();
    const player2Id = row.player2Id.trim();
    if (
      !player1Id
      || !player2Id
      || player1Id === player2Id
      || !(
        (player1Id === firstId && player2Id === secondId)
        || (player1Id === secondId && player2Id === firstId)
      )
      || !row.score.trim()
      || /\b(?:scheduled|pending|live|in progress)\b/i.test(row.score)
    ) {
      continue;
    }

    const normalizedRow = { ...row, player1Id, player2Id };
    const key = matchIdentity(normalizedRow);
    const existing = unique.get(key);
    if (existing === undefined) {
      unique.set(key, normalizedRow);
      continue;
    }
    if (existing && normalizeMatchScore(existing.score) !== normalizeMatchScore(row.score)) {
      unique.set(key, null);
    }
  }

  let firstWins = 0;
  let secondWins = 0;
  for (const row of unique.values()) {
    if (!row) continue;
    if (row.player1Id === firstId && row.player2Id === secondId) firstWins += 1;
    else if (row.player1Id === secondId && row.player2Id === firstId) secondWins += 1;
  }
  return { firstWins, secondWins, matches: firstWins + secondWins };
}

/**
 * The WTSL all-results feed is winner-oriented (player 1 is the match winner).
 * Unlike a player's profile recent-results table, this source identifies both sides
 * consistently. Identical duplicate rows count once; conflicting duplicates are excluded.
 */
export function computeOfficialClutchAggregates(
  rows: OfficialResult[],
): OfficialClutchAggregates {
  const unique = new Map<string, OfficialResult | null>();
  let duplicatesIgnored = 0;
  let conflictsIgnored = 0;
  for (const row of rows) {
    if (!row.player1Id.trim() || !row.player2Id.trim() || row.player1Id === row.player2Id) {
      continue;
    }
    const key = matchIdentity(row);
    const existing = unique.get(key);
    if (existing === undefined) {
      unique.set(key, row);
      continue;
    }
    duplicatesIgnored++;
    if (existing && normalizeMatchScore(existing.score) !== normalizeMatchScore(row.score)) {
      unique.set(key, null);
      conflictsIgnored++;
    }
  }

  const byPlayer = new Map<string, ClutchAggregate>();
  const ensurePlayer = (id: string) => {
    if (!byPlayer.has(id)) byPlayer.set(id, newAggregate());
    return byPlayer.get(id)!;
  };
  let matchesCounted = 0;
  for (const row of unique.values()) {
    if (!row) continue;
    const parsed = parseSets(row.score);
    const sets = parsed?.filter(isCompletedSet) ?? [];
    if (!sets.length) continue;
    const firstPlayer = ensurePlayer(row.player1Id);
    const secondPlayer = ensurePlayer(row.player2Id);
    let priorFirst = 0;
    let priorSecond = 0;

    sets.forEach(([first, second], index) => {
      const isLast = index === sets.length - 1;
      if (first > second) {
        firstPlayer.setsWon++;
        secondPlayer.setsLost++;
      } else {
        secondPlayer.setsWon++;
        firstPlayer.setsLost++;
      }
      if ((first === 6 && second === 7) || (first === 7 && second === 6)) {
        firstPlayer.tiebreaksPlayed++;
        secondPlayer.tiebreaksPlayed++;
        if (first > second) firstPlayer.tiebreaksWon++;
        else secondPlayer.tiebreaksWon++;
      }
      if (isLast && sets.length >= 3 && priorFirst === priorSecond) {
        firstPlayer.decidingSetsPlayed++;
        secondPlayer.decidingSetsPlayed++;
        if (first > second) firstPlayer.decidingSetsWon++;
        else secondPlayer.decidingSetsWon++;
      }
      if (first > second) priorFirst++;
      else priorSecond++;
    });
    matchesCounted++;
  }

  return {
    byPlayer,
    matchesSeen: rows.length,
    matchesCounted,
    duplicatesIgnored,
    conflictsIgnored,
  };
}