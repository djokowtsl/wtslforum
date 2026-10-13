const unsupportedProjectionFields = new Set([
  'simulation',
  'signals',
  'pointpatterns',
  'matchplay',
  'matchmode',
  'winnersper100',
  'forehandwinnersper100',
  'backhandwinnersper100',
  'unforcederrorsper100',
  'averagerallylength',
  'servepointswonpct',
  'returnpointswonpct',
  'matchwinpct',
]);

export function removeUnsupportedCharacterProjections(value) {
  if (Array.isArray(value)) {
    return value.map(removeUnsupportedCharacterProjections);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => {
        const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
        return !unsupportedProjectionFields.has(normalizedKey);
      })
      .map(([key, nestedValue]) => [
        key,
        removeUnsupportedCharacterProjections(nestedValue),
      ]),
  );
}
