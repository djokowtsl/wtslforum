import {
  characterBroadcastSetup,
  resolveBroadcastHandedness,
  resolveBroadcastStrokeStyles,
  type CharacterBroadcastSetup,
} from './liveCharacterBackhand.mjs';
import type { PlayerStrokeStylePair } from './liveCourtPerformance';

export type DmoReplayCharacterNames = readonly [
  string | null | undefined,
  string | null | undefined,
];

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
) {
  const setups = characterNames.map((name) => (
    name?.trim()
      ? setupsByName.get(normalizeDmoReplayCharacterName(name)) ?? null
      : null
  )) as [CharacterBroadcastSetup | null, CharacterBroadcastSetup | null];
  const characterHands = setups.map((setup) => setup?.playingHand ?? null) as [
    'left' | 'right' | null,
    'left' | 'right' | null,
  ];
  const backhandTypes = setups.map((setup) => setup?.backhandType ?? null) as [
    'one-handed' | 'two-handed' | null,
    'one-handed' | 'two-handed' | null,
  ];

  return {
    setups,
    handedness: resolveBroadcastHandedness(
      players,
      DEFAULT_HANDS,
      characterHands,
      [false, false],
    ),
    strokeStyles: resolveBroadcastStrokeStyles(
      players,
      DEFAULT_STROKE_STYLES,
      backhandTypes,
      [false, false],
    ),
    missingBackhandStyle: characterNames.map((name, index) => (
      Boolean(name?.trim()) && !setups[index]?.backhandType
    )) as [boolean, boolean],
  };
}
