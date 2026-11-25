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
        const sourcePriority = (row: TournamentResultRow) => row.source_id?.startsWith('recent:') ? 0 : 1;
        return sourcePriority(left) - sourcePriority(right)
          || matchSpecificity(match, right) - matchSpecificity(match, left);
      });
    if (candidates.length === 0) continue;

    const best = candidates[0];
    const bestScore = matchSpecificity(match, best);
    const bestSourcePriority = best.source_id?.startsWith('recent:') ? 0 : 1;
    const tiedCandidates = candidates.filter((candidate) =>
      matchSpecificity(match, candidate) === bestScore
      && (candidate.source_id?.startsWith('recent:') ? 0 : 1) === bestSourcePriority,
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
