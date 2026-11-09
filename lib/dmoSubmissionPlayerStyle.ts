import { characterBroadcastSetup } from './liveCharacterBackhand.mjs';

export type DmoPlayingHand = 'left' | 'right';
export type DmoBackhandType = 'one-handed' | 'two-handed';

export type DmoSubmissionCharacterOption = {
  character: string;
  playingHand: DmoPlayingHand | null;
  backhandType: DmoBackhandType | null;
};

export function isDmoPlayingHand(value: unknown): value is DmoPlayingHand {
  return value === 'left' || value === 'right';
}

export function isDmoBackhandType(value: unknown): value is DmoBackhandType {
  return value === 'one-handed' || value === 'two-handed';
}

export function parseDmoSubmissionCharacterRoster(value: unknown): DmoSubmissionCharacterOption[] {
  if (!Array.isArray(value)) return [];
  const options = new Map<string, DmoSubmissionCharacterOption>();

  for (const row of value) {
    if (!row || typeof row !== 'object' || !('character' in row)) continue;
    const character = typeof row.character === 'string' ? row.character.trim().slice(0, 100) : '';
    const key = character.toLocaleLowerCase('en-GB');
    if (!character || options.has(key)) continue;
    const setup = characterBroadcastSetup(row);
    options.set(key, {
      character,
      playingHand: setup.playingHand,
      backhandType: setup.backhandType,
    });
  }

  return [...options.values()].sort((left, right) => left.character.localeCompare(right.character, 'en'));
}
