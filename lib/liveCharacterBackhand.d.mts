export function inferredOneHandedBackhandPlayer(
  players: readonly string[] | null | undefined,
  playerIndex: number,
  backhandType: string | null | undefined,
): number | null;

export type PlayerStrokeStyle = {
  forehand: 'one' | 'two';
  backhand: 'one' | 'two';
};

export type PlayerStrokeStylePair = [PlayerStrokeStyle, PlayerStrokeStyle];

export function resolveBroadcastStrokeStyles(
  players: readonly [string, string] | null | undefined,
  selectedStyles: PlayerStrokeStylePair,
  characterBackhandTypes: readonly [string | null, string | null],
  manualBackhandOverrides: readonly [boolean, boolean],
): PlayerStrokeStylePair;
