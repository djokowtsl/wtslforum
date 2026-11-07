export type CharacterBroadcastSetup = {
  playingHand: 'left' | 'right' | null;
  backhandType: 'one-handed' | 'two-handed' | null;
};
export function characterBroadcastSetup(profile: unknown): CharacterBroadcastSetup;
export function resolveBroadcastHandedness(
  players: readonly [string, string] | null | undefined,
  selectedHands: readonly ['left' | 'right', 'left' | 'right'],
  characterHands: readonly ['left' | 'right' | null, 'left' | 'right' | null],
  manualOverrides: readonly [boolean, boolean],
): ['left' | 'right', 'left' | 'right'];

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
