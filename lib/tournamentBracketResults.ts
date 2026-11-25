import type { BracketMatch, TournamentBracketData } from './challongeBracketData';

export type TournamentResultRow = {
  player_one_id?: string | number | null;
  player_two_id?: string | number | null;
  player_one_name?: string | null;
  player_two_name?: string | null;
  winner_id?: string | number | null;
  score?: string | null;
  stats?: unknown;
  round_name?: string | null;
  source_id?: string | null;
  played_at?: string | Date | null;
  tournament_name?: string | null;
};

export function normalizeBracketPlayerName(value: unknown): string {
  return String(value ?? '')
    .replace(/^\s*\(\d+\)\s*/, '')
    .replace(/\s+\[[^\]]*\]\s*$/, '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en')
    .replace(/[^a-z0-9]/g, '');
}

function normalizedPair(first: unknown, second: unknown): string {
  return [normalizeBracketPlayerName(first), normalizeBracketPlayerName(second)].sort().join('|');
}

function reverseSetScores(score: string): string {
  const setPattern = /(\d+)\s*([-–])\s*(\d+)(\(\d+\))?/g;
  const sets = [...score.matchAll(setPattern)];
  const withoutSets = score.replace(setPattern, '').replace(/[\s,;:|]/g, '');
  if (sets.length === 0 || withoutSets) return score;
  return score.replace(setPattern, (_match, left: string, separator: string, right: string, tiebreak?: string) =>
    `${right}${separator}${left}${tiebreak ?? ''}`);
}

export function orientOfficialScore(score: string, playerOneName: unknown, bracketFirstName: unknown): string {
  return normalizeBracketPlayerName(playerOneName) === normalizeBracketPlayerName(bracketFirstName)
    ? score
    : reverseSetScores(score);
}

export function displayBracketScore(match: BracketMatch): string | null {
  const officialScore = match.officialScore?.trim();
  if (officialScore) return officialScore;

  const challongeScore = match.scores.map((score) => score?.trim() ?? '').filter(Boolean).join('-');
  if (!challongeScore) return null;
  if (/^0\s*-\s*0$/.test(challongeScore)) return 'Walkover';
  if (/^(?:1\s*-\s*0|0\s*-\s*1)$/.test(challongeScore)) return 'BCT';
  return challongeScore.replace(/\s*-\s*/g, '–');
}

export function normalizeOfficialResultScore(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[–—]/g, '-')
    .replace(/\s*-\s*/g, '-')
    .replace(/[,;]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('en');
}

function tournamentNamesOverlap(first: string, second: string): boolean {
  const left = first.toLocaleLowerCase('en').replace(/[^a-z0-9]/g, '');
  const right = second.toLocaleLowerCase('en').replace(/[^a-z0-9]/g, '');
  return Boolean(left && right && (left === right || left.startsWith(right) || right.startsWith(left)));
}

function sameDayOrAdjacent(first: string | Date, second: string | Date): boolean {
  const timestamp = (value: string | Date) =>
    value instanceof Date ? value.getTime() : Date.parse(value);
  const firstTime = timestamp(first);
  const secondTime = timestamp(second);
  if (!Number.isFinite(firstTime) || !Number.isFinite(secondTime)) return false;
  return Math.abs(Math.floor(firstTime / 86_400_000) - Math.floor(secondTime / 86_400_000)) <= 1;
}

function equivalentOfficialMeeting(
  first: TournamentResultRow,
  second: TournamentResultRow,
  referencePlayerName: string,
): boolean {
  const firstHasIds = first.player_one_id != null && first.player_two_id != null;
  const secondHasIds = second.player_one_id != null && second.player_two_id != null;
  const samePair = firstHasIds && secondHasIds
    ? [String(first.player_one_id), String(first.player_two_id)].sort().join('|')
      === [String(second.player_one_id), String(second.player_two_id)].sort().join('|')
    : normalizedPair(first.player_one_name, first.player_two_name)
      === normalizedPair(second.player_one_name, second.player_two_name);
  const firstScore = String(first.score ?? '');
  const secondScore = String(second.score ?? '');
  if (!samePair || !firstScore || !secondScore) return false;
  if (String(first.winner_id ?? '') !== String(second.winner_id ?? '')) return false;
  if (
    normalizeOfficialResultScore(orientOfficialScore(firstScore, first.player_one_name, referencePlayerName))
    !== normalizeOfficialResultScore(orientOfficialScore(secondScore, second.player_one_name, referencePlayerName))
  ) return false;
  if (!first.played_at || !second.played_at || !sameDayOrAdjacent(first.played_at, second.played_at)) return false;
  if (!first.tournament_name || !second.tournament_name
    || !tournamentNamesOverlap(first.tournament_name, second.tournament_name)) return false;
  const firstRound = String(first.round_name ?? '').toLocaleLowerCase('en').replace(/[^a-z0-9]/g, '');
  const secondRound = String(second.round_name ?? '').toLocaleLowerCase('en').replace(/[^a-z0-9]/g, '');
  return !firstRound || !secondRound || firstRound === secondRound;
}

export function dedupeEquivalentOfficialMeetings<T extends TournamentResultRow>(
  rows: T[],
  referencePlayerName: string,
): T[] {
  const unique: T[] = [];
  for (const row of rows) {
    const duplicateIndex = unique.findIndex((existing) =>
      equivalentOfficialMeeting(existing, row, referencePlayerName));
    if (duplicateIndex < 0) {
      unique.push(row);
      continue;
    }
    const existing = unique[duplicateIndex];
    if (row.source_id?.startsWith('recent:') && !existing.source_id?.startsWith('recent:')) {
      unique[duplicateIndex] = row;
    }
  }
  return unique;
}

function isPairMatch(match: BracketMatch, row: TournamentResultRow): boolean {
  const bracketPair = normalizedPair(match.team1, match.team2);
  const resultPair = normalizedPair(row.player_one_name, row.player_two_name);
  return Boolean(bracketPair.replace('|', '') && bracketPair === resultPair);
}

function officialWinner(match: BracketMatch, row: TournamentResultRow): 1 | 2 | null {
  if (row.winner_id == null) return null;
  const winnerId = String(row.winner_id);
  if (row.player_one_id != null && winnerId === String(row.player_one_id)) {
    return normalizeBracketPlayerName(row.player_one_name) === normalizeBracketPlayerName(match.team1) ? 1 : 2;
  }
  if (row.player_two_id != null && winnerId === String(row.player_two_id)) {
    return normalizeBracketPlayerName(row.player_two_name) === normalizeBracketPlayerName(match.team1) ? 1 : 2;
  }
  return null;
}

function matchSpecificity(match: BracketMatch, row: TournamentResultRow): number {
  const first = normalizeBracketPlayerName(match.team1);
  const second = normalizeBracketPlayerName(match.team2);
  const rowFirst = normalizeBracketPlayerName(row.player_one_name);
  const namesInBracketOrder = first === rowFirst && second === normalizeBracketPlayerName(row.player_two_name);
  const normalizeRound = (value: string) => value.toLocaleLowerCase('en').replace(/[^a-z0-9]/g, '');
  const roundMatches = Boolean(match.roundName && row.round_name)
    && normalizeRound(match.roundName) === normalizeRound(row.round_name!);
  return (namesInBracketOrder ? 1 : 0) + (roundMatches ? 2 : 0);
}

export function attachOfficialTournamentResults(
  bracket: TournamentBracketData,
  rows: TournamentResultRow[],
): TournamentBracketData {
  const matches = [...bracket.winners, ...bracket.losers, ...bracket.main]
    .flatMap((round) => round.matches);
  const enriched = new Map<string, BracketMatch>();

  for (const match of matches) {
    const candidates = rows
      .filter((row) => isPairMatch(match, row) && Boolean(row.score?.trim()))
      .sort((left, right) => {
        const sourcePriority = (row: TournamentResultRow) =>
          row.source_id?.startsWith('wtsl-tournament-page:') ? 0
            : row.source_id?.startsWith('recent:') ? 1 : 2;
        return sourcePriority(left) - sourcePriority(right)
          || matchSpecificity(match, right) - matchSpecificity(match, left);
      });
    if (candidates.length === 0) continue;

    const best = candidates[0];
    const bestScore = matchSpecificity(match, best);
    const bestSourcePriority = best.source_id?.startsWith('wtsl-tournament-page:') ? 0
      : best.source_id?.startsWith('recent:') ? 1 : 2;
    const tiedCandidates = candidates.filter((candidate) =>
      matchSpecificity(match, candidate) === bestScore
      && (candidate.source_id?.startsWith('wtsl-tournament-page:') ? 0
        : candidate.source_id?.startsWith('recent:') ? 1 : 2) === bestSourcePriority,
    );
    const distinctScores = new Set(tiedCandidates.map((candidate) => candidate.score?.trim()));
    if (distinctScores.size > 1) continue;

    const rowOrderMatchesBracket = normalizeBracketPlayerName(best.player_one_name)
      === normalizeBracketPlayerName(match.team1);
    const winner = officialWinner(match, best);
    enriched.set(match.matchId, {
      ...match,
      officialScore: rowOrderMatchesBracket
        ? best.score!.trim()
        : orientOfficialScore(best.score!.trim(), best.player_one_name, match.team1),
      ...(winner ? { winner } : {}),
    });
  }

  const updateRounds = (rounds: TournamentBracketData['main']) =>
    rounds.map((round) => ({
      ...round,
      matches: round.matches.map((match) => enriched.get(match.matchId) ?? match),
    }));

  return {
    ...bracket,
    winners: updateRounds(bracket.winners),
    losers: updateRounds(bracket.losers),
    main: updateRounds(bracket.main),
  };
}
