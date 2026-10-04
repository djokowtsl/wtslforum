export function exactPlayerNameMatches<T extends { name: string }>(
  players: readonly T[],
  query: string,
): T[] {
  const normalize = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return [];
  return players.filter((player) => normalize(player.name) === normalizedQuery);
}