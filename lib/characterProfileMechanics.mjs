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
  const heightNote = height
    ? 'Height can make a small difference on shoulder-high balls.'
    : '';
  const weightNote = weight
    ? 'Weight itself does not change speed or movement.'
    : '';
  return [dimensions, heightNote, weightNote].filter(Boolean).join('. ');
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
    .map(([stroke, type]) => `${type === 'one-handed' ? 'One-handed' : 'Two-handed'} ${stroke.toLowerCase()}`);
}

export function buildStrokeMechanicsInsight(profile = {}) {
  const forehandType = profile.forehand_type;
  const backhandType = profile.backhand_type;
  const handUse = [
    forehandType ? `a ${forehandType} forehand` : '',
    backhandType ? `a ${backhandType} backhand` : '',
  ].filter(Boolean);
  if (!handUse.length) return '';

  const twoHandedStrokes = [
    forehandType === 'two-handed' ? 'forehand' : '',
    backhandType === 'two-handed' ? 'backhand' : '',
  ].filter(Boolean);
  const combined = Array.isArray(profile.combined_ratings)
    ? profile.combined_ratings
    : [];
  const signals = profile.mechanics_insights?.signals || {};
  const backhandRating = Number(
    signals.backhand_rating
      ?? combined.find((item) => item.attribute === 'Backhand Rating')?.value,
  );
  const forehandRating = Number(
    signals.forehand_rating
      ?? combined.find((item) => item.attribute === 'Forehand Rating')?.value,
  );
  const forehandDisplay = Number.isFinite(forehandRating) ? forehandRating.toFixed(1) : null;
  const backhandDisplay = Number.isFinite(backhandRating) ? backhandRating.toFixed(1) : null;
  const setupNote = twoHandedStrokes.length
    ? ` Two-handed ${twoHandedStrokes.join(' and ')} strokes add +15 Counter and are safer in the Danger Zone, but trade a little power and width.`
    : '';
  let ratingNote = '';
  if (forehandDisplay !== null && backhandDisplay !== null) {
    ratingNote = forehandDisplay === backhandDisplay
      ? ` Groundstroke ratings are even at ${forehandDisplay}.`
      : ` Groundstroke ratings: Forehand ${forehandDisplay}, Backhand ${backhandDisplay}.`;
  }
  return `This character uses ${handUse.join(' and ')}.${setupNote}${ratingNote}`;
}
