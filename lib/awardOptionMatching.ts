export type ExistingAwardOption = { id: number | string; name: string };
export type RenamedAwardOption = { id: number | string; from: string; to: string; position: number };

const NON_CONTENT_WORDS = new Set(['a', 'an', 'and', 'at', 'beat', 'beats', 'def', 'in', 'of', 'on', 'over', 'the', 'v', 'vs']);
const MIN_RENAME_SCORE = 0.8;
const MIN_SHARED_WORDS = 2;
const MIN_BEST_MATCH_MARGIN = 0.12;

function normalizedName(value: string) {
  return value.trim().toLocaleLowerCase();
}

function contentWords(value: string) {
  return new Set(
    (value.normalize('NFKD').toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
      .filter((word) => !NON_CONTENT_WORDS.has(word)),
  );
}

function similarity(left: string, right: string) {
  const a = contentWords(left);
  const b = contentWords(right);
  if (a.size < MIN_SHARED_WORDS || b.size < MIN_SHARED_WORDS) return 0;

  let shared = 0;
  for (const word of a) {
    if (b.has(word)) shared += 1;
  }
  if (shared < MIN_SHARED_WORDS) return 0;

  const smallerSize = Math.min(a.size, b.size);
  const unionSize = a.size + b.size - shared;
  const containment = shared / smallerSize;
  const jaccard = shared / unionSize;
  return (0.7 * containment) + (0.3 * jaccard);
}

function uniqueBestMatch<T>(sourceName: string, candidates: T[], getName: (candidate: T) => string) {
  const ranked = candidates
    .map((candidate) => ({ candidate, score: similarity(sourceName, getName(candidate)) }))
    .filter((entry) => entry.score >= MIN_RENAME_SCORE)
    .sort((left, right) => right.score - left.score);

  if (!ranked[0] || (ranked[1] && ranked[0].score - ranked[1].score < MIN_BEST_MATCH_MARGIN)) {
    return null;
  }
  return ranked[0].candidate;
}

/**
 * Finds only high-confidence, mutually unique label edits. It deliberately
 * ignores option positions because shuffled Google Forms return them randomly.
 */
export function findRenamedAwardOptions(existing: ExistingAwardOption[], importedNames: string[]): RenamedAwardOption[] {
  const existingByName = new Set(existing.map((option) => normalizedName(option.name)));
  const importedByName = new Set(importedNames.map(normalizedName));
  const unmatchedExisting = existing.filter((option) => !importedByName.has(normalizedName(option.name)));
  const unmatchedImported = importedNames
    .map((name, index) => ({ name, position: index + 1 }))
    .filter((option) => !existingByName.has(normalizedName(option.name)));

  const matches: RenamedAwardOption[] = [];
  const matchedExistingIds = new Set<number | string>();
  const matchedImportedNames = new Set<string>();

  for (const oldOption of unmatchedExisting) {
    const bestImported = uniqueBestMatch(oldOption.name, unmatchedImported, (option) => option.name);
    if (!bestImported || matchedImportedNames.has(normalizedName(bestImported.name))) continue;

    const bestExisting = uniqueBestMatch(bestImported.name, unmatchedExisting, (option) => option.name);
    if (!bestExisting || bestExisting.id !== oldOption.id || matchedExistingIds.has(oldOption.id)) continue;

    matches.push({
      id: oldOption.id,
      from: oldOption.name,
      to: bestImported.name,
      position: bestImported.position,
    });
    matchedExistingIds.add(oldOption.id);
    matchedImportedNames.add(normalizedName(bestImported.name));
  }

  return matches;
}
