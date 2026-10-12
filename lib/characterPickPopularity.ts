export type CharacterPickCount = {
  character: string;
  picks: number | string;
};

export type CharacterPickRanking = {
  rank: number;
  picks: number;
  tied: boolean;
};

function normalizeCharacterName(name: string) {
  return name.trim().toLocaleLowerCase();
}

/** Rank one character against the recorded pick totals, using shared competition ranks for ties. */
export function rankCharacterPickCounts(
  rows: readonly CharacterPickCount[],
  character: string,
  expectedPicks: number,
): CharacterPickRanking | null {
  if (!Number.isSafeInteger(expectedPicks) || expectedPicks <= 0) return null;

  const targetName = normalizeCharacterName(character);
  if (!targetName) return null;

  const totals = new Map<string, { character: string; picks: number }>();
  for (const row of rows) {
    if (typeof row.character !== 'string') continue;
    const normalizedName = normalizeCharacterName(row.character);
    const picks = Number(row.picks);
    if (!normalizedName || !Number.isSafeInteger(picks) || picks <= 0) continue;

    const current = totals.get(normalizedName);
    if (current) current.picks += picks;
    else totals.set(normalizedName, { character: row.character.trim(), picks });
  }

  const ordered = [...totals.entries()]
    .map(([normalizedName, item]) => ({ normalizedName, ...item }))
    .sort((left, right) => right.picks - left.picks ||
      left.normalizedName.localeCompare(right.normalizedName));
  const target = ordered.find((item) => item.normalizedName === targetName);
  if (!target || target.picks !== expectedPicks) return null;

  const rank = ordered.findIndex((item) => item.picks === target.picks) + 1;
  const tied = ordered.filter((item) => item.picks === target.picks).length > 1;
  return { rank, picks: target.picks, tied };
}

export function formatOrdinalRank(rank: number) {
  if (!Number.isSafeInteger(rank) || rank < 1) return '';
  const lastTwoDigits = rank % 100;
  const suffix = lastTwoDigits >= 11 && lastTwoDigits <= 13
    ? 'th'
    : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[rank % 10] || 'th';
  return `${rank}${suffix}`;
}
