export type CharacterPickRanking = {
  rank: number;
  picks: number;
  tied: boolean;
  character_count: number;
};

/** Accept only a Core API rank consistent with the official count shown on the card. */
export function parseCharacterPickRanking(
  value: unknown,
  expectedPicks: number,
): CharacterPickRanking | null {
  if (!Number.isSafeInteger(expectedPicks) || expectedPicks <= 0) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const candidate = value as Record<string, unknown>;
  const { rank, picks, tied, character_count } = candidate;
  if (
    typeof rank !== 'number' ||
    !Number.isSafeInteger(rank) ||
    rank < 1 ||
    typeof picks !== 'number' ||
    !Number.isSafeInteger(picks) ||
    picks !== expectedPicks ||
    typeof tied !== 'boolean' ||
    typeof character_count !== 'number' ||
    !Number.isSafeInteger(character_count) ||
    character_count < 1 ||
    rank > character_count
  ) {
    return null;
  }

  return { rank, picks, tied, character_count };
}

export function formatOrdinalRank(rank: number) {
  if (!Number.isSafeInteger(rank) || rank < 1) return '';
  const lastTwoDigits = rank % 100;
  const suffix = lastTwoDigits >= 11 && lastTwoDigits <= 13
    ? 'th'
    : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[rank % 10] || 'th';
  return `${rank}${suffix}`;
}
