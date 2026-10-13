const categoryRules = [
  { name: 'Serve', matches: ['serve'] },
  { name: 'Power', matches: ['power', 'smash'] },
  { name: 'Consistency', matches: ['consistency', 'focus'] },
  { name: 'Precision', matches: ['precision', 'ball feeling'] },
  { name: 'Net & Feel', matches: ['volley', 'net presence', 'ball feeling', 'smash'] },
  { name: 'Movement', matches: ['speed', 'stamina', 'muscle tone', 'counter'] },
  { name: 'Variety', matches: ['slice', 'early ball', 'lob', 'dropshot', 'topspin'] },
];

const excludedAttributes = new Set([
  'sliceserve',
  'topspinserve',
  'twistserve',
  'boomboomserver',
  'ontimeserver',
]);

function percentileScore(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return Math.round(Math.max(0, Math.min(100, number <= 1 ? number * 100 : number)));
}

function sortScores(scores) {
  return scores.sort(
    (first, second) => second.score - first.score || first.name.localeCompare(second.name),
  );
}

export function characterCategoryScores(groupScores, stats) {
  if (groupScores && typeof groupScores === 'object' && !Array.isArray(groupScores)) {
    const provided = Object.entries(groupScores).flatMap(([name, value]) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
      const score = percentileScore(value.score ?? value.percentile);
      const edges = Array.isArray(value.edges)
        ? value.edges.filter((item) => item && typeof item === 'object')
        : [];
      return score === null || edges.length === 0 ? [] : [{ name, score, edges }];
    });
    if (provided.length > 0) return sortScores(provided);
  }

  const buckets = new Map(categoryRules.map(({ name }) => [name, []]));
  for (const stat of Array.isArray(stats) ? stats : []) {
    if (!stat || typeof stat !== 'object' || stat.rank == null) continue;
    const normalizedAttribute = String(stat.attribute ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (excludedAttributes.has(normalizedAttribute)) continue;
    const score = percentileScore(stat.percentile);
    if (score === null) continue;
    const attribute = String(stat.attribute ?? '').toLowerCase();
    const category = categoryRules.find((rule) =>
      rule.matches.some((match) => attribute.includes(match)),
    )?.name;
    if (category) buckets.get(category)?.push({ ...stat, score });
  }

  const computed = [];
  for (const [name, values] of buckets.entries()) {
    if (values.length === 0) continue;
    const score = Math.round(values.reduce((sum, item) => sum + item.score, 0) / values.length);
    const edges = values
      .sort((first, second) => second.score - first.score)
      .map(({ score: _score, ...stat }) => stat);
    computed.push({ name, score, edges });
  }
  return sortScores(computed);
}
