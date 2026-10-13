function dimension(value, label, unit) {
  if (value === null || value === undefined || value === '') return '';
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return '';
  const formatted = Number.isInteger(parsed) ? String(parsed) : parsed.toFixed(1);
  return `${label} ${formatted} ${unit}`;
}

export function buildSizeMechanicsInsight(height, weight) {
  const dimensions = [
    dimension(height, 'Height', 'cm'),
    dimension(weight, 'weight', 'kg'),
  ].filter(Boolean).join(' · ');
  if (!dimensions) return '';
  return `${dimensions}. TE4 gives smaller characters a very small run-acceleration bonus that offsets shorter wingspan, so smaller characters are not handicapped.`;
}

export function buildStrokeSetupLabels({
  forehand_type: forehandType,
  backhand_type: backhandType,
} = {}) {
  return [
    ['Forehand', forehandType],
    ['Backhand', backhandType],
  ]
    .filter(([, type]) => type === 'one-handed' || type === 'two-handed')
    .map(([stroke, type]) => `${stroke}: ${type}`);
}

export function buildStrokeMechanicsInsight({
  forehand_type: forehandType,
  backhand_type: backhandType,
} = {}) {
  const twoHandedStrokes = [
    forehandType === 'two-handed' ? 'forehand' : '',
    backhandType === 'two-handed' ? 'backhand' : '',
  ].filter(Boolean);
  if (!twoHandedStrokes.length) return '';

  const isPlural = twoHandedStrokes.length === 2;
  const strokeLabel = isPlural
    ? 'Two-handed forehands and backhands'
    : `The two-handed ${twoHandedStrokes[0]}`;
  const subjectVerb = isPlural ? 'are' : 'is';
  const followUp = isPlural ? 'they are' : 'it is';
  const addVerb = isPlural ? 'add' : 'adds';
  const oneHandedComparison = isPlural ? 'their one-handed versions' : 'its one-handed version';
  return `${strokeLabel} ${subjectVerb} slightly less powerful and less wide (the player needs to get closer to the ball) than ${oneHandedComparison}, but ${followUp} safer in the orange/red Danger Zone and ${addVerb} 15 points to Counter.`;
}
