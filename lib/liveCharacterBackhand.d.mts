export function matchingPlayerIndex(
  players: readonly string[] | null | undefined,
  characterName: string | null | undefined,
): number | null;

export function inferredOneHandedBackhandPlayer(
  players: readonly string[] | null | undefined,
  characterName: string | null | undefined,
  backhandType: string | null | undefined,
): number | null;
