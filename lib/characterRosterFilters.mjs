const filterFields = new Set([
  'acceleration',
  'style',
  'playing_hand',
  'forehand_type',
  'backhand_type',
  'country',
]);

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalize(value) {
  return clean(value).toLocaleLowerCase();
}

export function characterFilterOptions(metadata, field) {
  if (!filterFields.has(field)) return [];

  const values = new Map();
  for (const row of metadata) {
    const value = clean(row?.[field]);
    const key = normalize(value);
    if (key && !values.has(key)) values.set(key, value);
  }

  return [...values.values()].sort((first, second) =>
    first.localeCompare(second, undefined, { sensitivity: 'base' }),
  );
}

export function filterCharacterNames(names, metadata, filters) {
  const activeFilters = Object.entries(filters)
    .filter(([field, value]) => filterFields.has(field) && normalize(value));
  if (!activeFilters.length) return names;

  const metadataByCharacter = new Map(
    metadata.map((row) => [normalize(row.character), row]),
  );
  return names.filter((name) => {
    const row = metadataByCharacter.get(normalize(name));
    return Boolean(row) && activeFilters.every(([field, value]) =>
      normalize(row[field]) === normalize(value),
    );
  });
}
