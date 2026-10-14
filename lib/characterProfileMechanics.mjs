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
    ? 'Height feeds only a small, directional estimate of rising-bounce pressure.'
    : '';
  const weightNote = weight
    ? 'The documented mechanics give weight no separate power or movement modifier.'
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
    ? ` The TE4 manual says two-handed ${twoHandedStrokes.join(' and ')} strokes add +15 Counter and are safer in the Danger Zone, but trade a little power and width.`
    : ' The TE4 manual says two-handed strokes trade a little power and width for +15 Counter and safer contact in the Danger Zone; no two-handed stroke is listed here.';
  let ratingNote = '';
  if (forehandDisplay !== null && backhandDisplay !== null) {
    ratingNote = forehandDisplay === backhandDisplay
      ? ` WTSL combined groundstroke estimates are evenly rated at ${forehandDisplay}; they are profile estimates, not per-shot outcome predictions.`
      : ` WTSL combined groundstroke estimates are Forehand ${forehandDisplay} and Backhand ${backhandDisplay}; they are profile estimates, not per-shot outcome predictions.`;
  }
  return `This character uses ${handUse.join(' and ')}.${setupNote}${ratingNote}`;
}
