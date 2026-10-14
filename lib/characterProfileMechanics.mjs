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
    .map(([stroke, type]) => `${stroke}: ${type}`);
}

export function buildStrokeMechanicsInsight(profile = {}) {
  const forehandType = profile.forehand_type;
  const backhandType = profile.backhand_type;
  const setupLabels = [
    forehandType ? `forehand ${forehandType}` : '',
    backhandType ? `backhand ${backhandType}` : '',
  ].filter(Boolean);
  if (!setupLabels.length) return '';

  const twoHandedStrokes = [
    forehandType === 'two-handed' ? 'forehand' : '',
    backhandType === 'two-handed' ? 'backhand' : '',
  ].filter(Boolean);
  const stats = Array.isArray(profile.stats) ? profile.stats : [];
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
  const highBounceFit = Number(signals.backhand_high_bounce_fit);
  const forehandDisplay = Number.isFinite(forehandRating) ? forehandRating.toFixed(1) : null;
  const backhandDisplay = Number.isFinite(backhandRating) ? backhandRating.toFixed(1) : null;
  const setupNote = twoHandedStrokes.length
    ? `The TE4 manual says two-handed ${twoHandedStrokes.join(' and ')} strokes add 15 Counter and are safer in the Danger Zone, but have a little less power and width.`
    : 'The TE4 manual’s +15 Counter and Danger Zone benefit applies to two-handed strokes; no two-handed setup is recorded here.';
  let ratingNote = '';
  if (forehandDisplay !== null && backhandDisplay !== null) {
    ratingNote = forehandDisplay === backhandDisplay
      ? ` WTSL combined groundstroke estimates are evenly rated at ${forehandDisplay}; they are profile estimates, not per-shot outcome predictions.`
      : ` WTSL combined groundstroke estimates are Forehand ${forehandDisplay} and Backhand ${backhandDisplay}; they are profile estimates, not per-shot outcome predictions.`;
  }
  const fitNote = Number.isFinite(highBounceFit)
    ? ` WTSL’s backhand shoulder-height fit is ${highBounceFit.toFixed(0)}/100, a directional model estimate rather than a TE4 game stat.`
    : '';
  const contactNote = Number.isFinite(highBounceFit)
    ? ' The TE4 manual says Acceleration is fastest near the top of the bounce; high contact and Danger Zone positioning add penalties.'
    : '';

  return `Setup: ${setupLabels.join(', ')}. ${setupNote}${ratingNote}${fitNote}${contactNote}`;
}
