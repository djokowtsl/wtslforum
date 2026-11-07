function normalizePlayerName(value) {
  return typeof value === 'string'
    ? value.normalize('NFKD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
    : '';
}

export function matchingPlayerIndex(players, characterName) {
  const target = normalizePlayerName(characterName);
  if (!target || !Array.isArray(players)) return null;
  const matches = players.flatMap((name, index) =>
    normalizePlayerName(name) === target ? [index] : []);
  return matches.length === 1 ? matches[0] : null;
}

export function inferredOneHandedBackhandPlayer(players, characterName, backhandType) {
  if (backhandType !== 'one-handed') return null;
  return matchingPlayerIndex(players, characterName);
}
