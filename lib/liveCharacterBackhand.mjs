export function characterBroadcastSetup(profile) {
  return {
    playingHand: profile?.playing_hand === 'left' || profile?.playing_hand === 'right'
      ? profile.playing_hand : null,
    backhandType: profile?.backhand_type === 'one-handed' || profile?.backhand_type === 'two-handed'
      ? profile.backhand_type : null,
  };
}

export function resolveBroadcastHandedness(players, selectedHands, characterHands, manualOverrides) {
  return selectedHands.map((hand, index) => (
    Array.isArray(players) && typeof players[index] === 'string'
      && !manualOverrides[index]
      && (characterHands[index] === 'left' || characterHands[index] === 'right')
      ? characterHands[index] : hand
  ));
}

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
