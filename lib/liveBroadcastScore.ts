import {
  liveMatchPlayers,
  normalizeLivePlayerName,
  resolveFakePrefixForRankedPlayer,
  sameLiveMatch,
} from './liveBroadcast';

export type LiveBroadcastScore = {
  sets: [number, number][];
  games: [number, number];
  pointText: [string, string];
  tiebreak: boolean;
  server: 1 | 2 | null;
  checkedAt: string;
};

export type LiveBroadcastScoreMatch = {
  name: string;
  score: string;
  bestOf: 1 | 3 | 5;
  rankedPlayers?: [string | null, string | null];
};

export type LiveBroadcastScoreFeed = {
  matches: LiveBroadcastScoreMatch[];
  checkedAt: string;
};

/** Parse TE4's scoreboard, not a score reconstructed from DMO point outcomes. */
export function parseLiveBroadcastScore(raw: string, checkedAt: string): LiveBroadcastScore | null {
  const parts = raw.trim().split(/\s*--\s*/);
  if (parts.length !== 2) return null;
  const gameTokens = parts[0].trim().split(/\s+/);
  if (!gameTokens.length || gameTokens.length > 6) return null;
  const pairs: [number, number][] = [];
  for (const token of gameTokens) {
    const match = token.match(/^(\d+)\/(\d+)(?:\(\d+\))?$/);
    if (!match) return null;
    const pair: [number, number] = [Number(match[1]), Number(match[2])];
    if (pair.some((value) => value > 7)) return null;
    pairs.push(pair);
  }
  const points = parts[1].trim().match(/^(•)?\s*(\d+|AD|ADV|A)\s*:\s*(\d+|AD|ADV|A)\s*(•)?$/i);
  if (!points || (points[1] && points[4])) return null;
  const pointText = [points[2], points[3]].map((value) =>
    /^(?:AD|ADV|A)$/i.test(value) ? 'AD' : String(Number(value)),
  ) as [string, string];
  if (pointText.some((value) => value !== 'AD' && Number(value) > 100)) return null;
  const games = pairs.pop()!;
  const tiebreak = (games[0] === 6 && games[1] === 6)
    || pointText.some((value) => value !== 'AD' && !['0', '15', '30', '40'].includes(value));
  if (tiebreak && pointText.includes('AD')) return null;
  return {
    sets: pairs,
    games,
    pointText,
    tiebreak,
    server: points[1] ? 1 : points[4] ? 2 : null,
    checkedAt,
  };
}

/** Keep every score column and the serve indicator in the displayed name order. */
export function scoreForLiveBroadcast(
  feed: LiveBroadcastScoreFeed | null,
  players: [string, string],
  bestOf: number,
): LiveBroadcastScore | null {
  if (!feed) return null;
  const matches = feed.matches.filter((match) => {
    const source = liveMatchPlayers(match.name);
    const rankedNames = match.rankedPlayers?.filter((name): name is string => Boolean(name)) ?? [];
    const rankedPair = rankedNames.length === 2 ? rankedNames as [string, string] : null;
    return match.bestOf === bestOf && (
      sameLiveMatch(players, source, rankedNames)
      || sameLiveMatch(players, rankedPair, rankedNames)
    );
  });
  if (matches.length !== 1) return null;
  const match = matches[0];
  const rawPlayers = liveMatchPlayers(match.name)!;
  const sourcePlayers = rawPlayers.map((name, index) => match.rankedPlayers?.[index] || name);
  const normalize = (name: string) => normalizeLivePlayerName(
    resolveFakePrefixForRankedPlayer(name, sourcePlayers),
  );
  const target = players.map(normalize);
  const source = sourcePlayers.map(normalize);
  if (!target[0] || target[0] === target[1]) return null;
  const reversed = target[0] === source[1] && target[1] === source[0];
  if (!reversed && !(target[0] === source[0] && target[1] === source[1])) return null;
  const score = parseLiveBroadcastScore(match.score, feed.checkedAt);
  if (!score || !reversed) return score;
  return {
    ...score,
    sets: score.sets.map(([first, second]) => [second, first]),
    games: [score.games[1], score.games[0]],
    pointText: [score.pointText[1], score.pointText[0]],
    server: score.server === null ? null : score.server === 1 ? 2 : 1,
  };
}
