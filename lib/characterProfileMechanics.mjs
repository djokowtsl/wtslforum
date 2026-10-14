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
  const statValue = (attribute) => {
    const stat = stats.find((item) => item.attribute === attribute);
    const value = Number(stat?.value);
    return Number.isFinite(value) ? value : null;
  };
  const counter = statValue('Counter') ?? Number(signals.counter);
  const effectiveCounter = Number.isFinite(Number(signals.effective_counter))
    ? Number(signals.effective_counter)
    : Math.min(100, counter + (twoHandedStrokes.length ? 15 : 0));
  const backhandRating = Number(
    signals.backhand_rating
      ?? combined.find((item) => item.attribute === 'Backhand Rating')?.value,
  );
  const forehandRating = Number(
    signals.forehand_rating
      ?? combined.find((item) => item.attribute === 'Forehand Rating')?.value,
  );
  const highBounceFit = Number(signals.backhand_high_bounce_fit);
  const backhandNote = Number.isFinite(backhandRating)
    ? `Backhand Rating ${backhandRating.toFixed(1)}`
      + (Number.isFinite(highBounceFit)
        ? ` and a ${highBounceFit.toFixed(0)}/100 directional high-bounce fit`
        : '')
      + (highBounceFit >= 65
        ? " support taking heavy topspin early once you're set. Use a Normal strike if the ball climbs to head height; save Acceleration or Short Acceleration for a short ball you can attack in balance."
        : " favor a Normal rally strike first, then use the Top Spin strike for added clearance once you're set. Use a Short Strike only after moving the opponent deep, and avoid acceleration from a rushed or head-height contact.")
    : '';
  const forehandDisplay = Number.isFinite(forehandRating) ? forehandRating.toFixed(1) : null;
  const backhandDisplay = Number.isFinite(backhandRating) ? backhandRating.toFixed(1) : null;
  let wingNote = '';
  if (forehandDisplay !== null && backhandDisplay !== null) {
    if (forehandDisplay === backhandDisplay) {
      wingNote =
        ` Forehand and backhand are evenly rated (${forehandDisplay} each); neither has a rating edge.`
        + ' Choose the better-positioned wing to attack a shorter reply.';
    } else {
      const forehandIsStronger = Number(forehandDisplay) > Number(backhandDisplay);
      const strongerWing = forehandIsStronger ? 'forehand' : 'backhand';
      const strongerRating = forehandIsStronger ? forehandDisplay : backhandDisplay;
      const weakerRating = forehandIsStronger ? backhandDisplay : forehandDisplay;
      wingNote =
        ` The ${strongerWing} is the stronger groundstroke (${strongerRating} vs ${weakerRating});`
        + ' use it to attack a shorter reply.';
    }
  }
  const counterNote = twoHandedStrokes.length
    ? `The two-handed ${twoHandedStrokes.join(' and ')} setup adds +15 Counter (${counter} to ${effectiveCounter}).`
    : `No two-handed stroke is recorded, so setup adds no +15 Counter (sheet Counter ${counter}).`;

  return `Setup: ${setupLabels.join(', ')}. ${counterNote} ${backhandNote}${wingNote}`.trim();
}
