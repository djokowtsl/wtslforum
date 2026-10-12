export type CharacterUsageRow = {
  player1Id: string;
  player1Character: string | null;
  player2Id: string;
  player2Character: string | null;
  score?: string;
};

export type CharacterUsageEntry = {
  playerId: string;
  character: string;
  picks: number;
};

export type PlayerCharacterSummary = {
  playerId: string;
  favoriteCharacter: string;
  favoriteCharacterPicks: number;
  characterMatches: number;
};

export function aggregateCharacterUsage(rows: readonly CharacterUsageRow[]) {
  const picksByPlayer = new Map<string, Map<string, { character: string; picks: number }>>();

  function recordPick(playerId: string, rawCharacter: string | null) {
    const character = rawCharacter?.trim();
    if (!playerId || !character) return;

    let playerPicks = picksByPlayer.get(playerId);
    if (!playerPicks) {
      playerPicks = new Map();
      picksByPlayer.set(playerId, playerPicks);
    }

    const normalized = character.toLowerCase();
    const existing = playerPicks.get(normalized);
    if (existing) existing.picks++;
    else playerPicks.set(normalized, { character, picks: 1 });
  }

  for (const row of rows) {
    // A character choice is a recorded pick even when the match has no ordinary set score
    // (for example, a walkover, coin toss, or a scheduled fixture).
    recordPick(row.player1Id, row.player1Character);
    recordPick(row.player2Id, row.player2Character);
  }

  const entries: CharacterUsageEntry[] = [];
  const summaries: PlayerCharacterSummary[] = [];
  let picksCounted = 0;

  for (const [playerId, playerPicks] of picksByPlayer) {
    let favoriteCharacter = '';
    let favoriteCharacterPicks = 0;
    let characterMatches = 0;

    for (const { character, picks } of playerPicks.values()) {
      entries.push({ playerId, character, picks });
      characterMatches += picks;
      picksCounted += picks;
      if (picks > favoriteCharacterPicks) {
        favoriteCharacter = character;
        favoriteCharacterPicks = picks;
      }
    }

    summaries.push({
      playerId,
      favoriteCharacter,
      favoriteCharacterPicks,
      characterMatches,
    });
  }

  return { entries, summaries, picksCounted };
}
