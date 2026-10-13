type CharacterCategoryStat = {
  attribute: string;
  value: number | string | null;
  rank: number | null;
  count: number;
  percentile: number | null;
  [key: string]: unknown;
};

export function characterCategoryScores(
  groupScores: unknown,
  stats: CharacterCategoryStat[],
): { name: string; score: number; edges: CharacterCategoryStat[] }[];
