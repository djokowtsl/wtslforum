import {
  characterBroadcastSetup,
  resolveBroadcastHandedness,
  resolveBroadcastStrokeStyles,
  type CharacterBroadcastSetup,
} from './liveCharacterBackhand.mjs';
import type { PlayerStrokeStylePair } from './liveCourtPerformance';
import {
  isDmoBackhandType,
  isDmoPlayingHand,
  type DmoBackhandType,
  type DmoPlayingHand,
} from './dmoSubmissionPlayerStyle';

export type DmoReplayCharacterNames = readonly [
  string | null | undefined,
  string | null | undefined,
];

export type DmoReplayPlayerStyleValues = {
  handedness?: readonly [DmoPlayingHand | null | undefined, DmoPlayingHand | null | undefined];
  backhandTypes?: readonly [DmoBackhandType | null | undefined, DmoBackhandType | null | undefined];
};

/** Legacy Discord submissions stored explicit picks in trailing parentheses. */
export function dmoReplayCharacterNames(
  players: readonly [string, string],
  savedPicks: DmoReplayCharacterNames,
): [string | null, string | null] {
  return players.map((player, index) => {
    const saved = savedPicks[index]?.trim();
    if (saved) return saved;
    // This is only a lookup candidate: roster metadata must confirm its style.
    // Never infer a character from the member's display name itself.
    return player.match(/\(([^()]+)\)\s*$/)?.[1].trim() || null;
  }) as [string | null, string | null];
}

const DEFAULT_HANDS: ['right', 'right'] = ['right', 'right'];
const DEFAULT_STROKE_STYLES: PlayerStrokeStylePair = [
  { forehand: 'one', backhand: 'two' },
  { forehand: 'one', backhand: 'two' },
];

export function normalizeDmoReplayCharacterName(name: string) {
  return name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-GB');
}

export function dmoReplayPlayerStyleOrder(
  submissionPlayers: readonly [string, string],
  replayPlayers: readonly [string, string],
): [number, number] {
  const submissionNames = submissionPlayers.map(normalizeDmoReplayCharacterName) as [string, string];
  const replayNames = replayPlayers.map(normalizeDmoReplayCharacterName) as [string, string];
  if (
    !submissionNames.every(Boolean)
    || !replayNames.every(Boolean)
    || submissionNames[0] === submissionNames[1]
    || replayNames[0] === replayNames[1]
  ) return [0, 1];

  const firstMatch = submissionNames.indexOf(replayNames[0]);
  const secondMatch = submissionNames.indexOf(replayNames[1]);
  if (firstMatch >= 0 && secondMatch >= 0 && firstMatch !== secondMatch) {
    return [firstMatch, secondMatch];
  }
  if (firstMatch >= 0) return [firstMatch, 1 - firstMatch];
  if (secondMatch >= 0) return [1 - secondMatch, secondMatch];
  return [0, 1];
}

export function alignDmoReplayPlayerStyles<T>(
  submissionPlayers: readonly [string, string],
  replayPlayers: readonly [string, string],
  styles: readonly [T, T],
): [T, T] {
  const order = dmoReplayPlayerStyleOrder(submissionPlayers, replayPlayers);
  return [styles[order[0]], styles[order[1]]];
}

export function buildDmoReplayCharacterSetupIndex(rows: unknown) {
  const setups = new Map<string, CharacterBroadcastSetup>();
  if (!Array.isArray(rows)) return setups;

  for (const row of rows) {
    if (!row || typeof row !== 'object' || !('character' in row) || typeof row.character !== 'string') {
      continue;
    }
    const key = normalizeDmoReplayCharacterName(row.character);
    if (key) setups.set(key, characterBroadcastSetup(row));
  }
  return setups;
}

export function resolveDmoReplayCharacterPresentation(
  players: readonly [string, string],
  characterNames: DmoReplayCharacterNames,
  setupsByName: ReadonlyMap<string, CharacterBroadcastSetup>,
  savedStyles: DmoReplayPlayerStyleValues = {},
) {
  const setups = characterNames.map((name) => (
    name?.trim()
      ? setupsByName.get(normalizeDmoReplayCharacterName(name)) ?? null
      : null
  )) as [CharacterBroadcastSetup | null, CharacterBroadcastSetup | null];
  const savedHands = savedStyles.handedness ?? [null, null];
  const savedBackhands = savedStyles.backhandTypes ?? [null, null];
  const selectedHands = savedHands.map((hand, index) => (
    isDmoPlayingHand(hand) ? hand : DEFAULT_HANDS[index]
  )) as ['right' | 'left', 'right' | 'left'];
  const characterHands = setups.map((setup) => setup?.playingHand ?? null) as [
    'left' | 'right' | null,
    'left' | 'right' | null,
  ];
  const backhandTypes = setups.map((setup) => setup?.backhandType ?? null) as [
    'one-handed' | 'two-handed' | null,
    'one-handed' | 'two-handed' | null,
  ];
  const selectedStyles = savedBackhands.map((backhand, index) => {
    const style = DEFAULT_STROKE_STYLES[index];
    return isDmoBackhandType(backhand)
      ? { ...style, backhand: backhand === 'one-handed' ? 'one' : 'two' }
      : { ...style };
  }) as PlayerStrokeStylePair;
  const handOverrides = savedHands.map(isDmoPlayingHand) as [boolean, boolean];
  const backhandOverrides = savedBackhands.map(isDmoBackhandType) as [boolean, boolean];

  return {
    setups,
    handedness: resolveBroadcastHandedness(
      players,
      selectedHands,
      characterHands,
      handOverrides,
    ),
    strokeStyles: resolveBroadcastStrokeStyles(
      players,
      selectedStyles,
      backhandTypes,
      backhandOverrides,
    ),
    missingBackhandStyle: characterNames.map((name, index) => (
      Boolean(name?.trim())
      && !isDmoBackhandType(savedBackhands[index])
      && !backhandTypes[index]
    )) as [boolean, boolean],
  };
}
