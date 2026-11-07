export function inferredOneHandedBackhandPlayer(players, playerIndex, backhandType) {
  if (
    backhandType !== 'one-handed'
    || !Array.isArray(players)
    || !Number.isInteger(playerIndex)
    || playerIndex < 0
    || playerIndex >= players.length
    || typeof players[playerIndex] !== 'string'
  ) return null;
  return playerIndex;
}

export function resolveBroadcastStrokeStyles(
  players,
  selectedStyles,
  characterBackhandTypes,
  manualBackhandOverrides,
) {
  const result = selectedStyles.map(style => ({ ...style }));
  if (!Array.isArray(players)) return result;

  for (let playerIndex = 0; playerIndex < 2; playerIndex += 1) {
    const inferredPlayer = inferredOneHandedBackhandPlayer(
      players,
      playerIndex,
      characterBackhandTypes[playerIndex],
    );
    if (inferredPlayer === null || manualBackhandOverrides[inferredPlayer]) continue;
    result[inferredPlayer] = { ...result[inferredPlayer], backhand: 'one' };
  }
  return result;
}
