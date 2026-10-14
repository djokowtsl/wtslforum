function dimension(value, label, unit) {
  if (value === null || value === undefined || value === '') return '';
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return '';
  const formatted = Number.isInteger(parsed) ? String(parsed) : parsed.toFixed(1);
  return `${label} ${formatted} ${unit}`;
}

export function buildSizeMechanicsInsight(height) {
  const heightDimension = dimension(height, 'Height', 'cm');
  if (!heightDimension) return '';
  return `${heightDimension}. Height can make a small difference on shoulder-high balls.`;
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

export function buildPlayingHandLabel(value) {
  const hand = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (hand === 'left') return 'Left-handed';
  if (hand === 'right') return 'Right-handed';
  return null;
}

export function buildStrokeMechanicsInsight(profile = {}) {
  const forehandType = profile.forehand_type;
  const backhandType = profile.backhand_type;
  const handUse = [
    forehandType ? `a ${forehandType} forehand` : '',
    backhandType ? `a ${backhandType} backhand` : '',
  ].filter(Boolean);
  const twoHandedStrokes = [
    forehandType === 'two-handed' ? 'forehand' : '',
    backhandType === 'two-handed' ? 'backhand' : '',
  ].filter(Boolean);
  const oneHandedStrokes = [
    forehandType === 'one-handed' ? 'forehand' : '',
    backhandType === 'one-handed' ? 'backhand' : '',
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
    ? twoHandedStrokes.length > 1
      ? ` The two-handed ${twoHandedStrokes.join(' and ')} strokes add +15 Counter and are safer in the Danger Zone, at the cost of some power and width.`
      : ` The two-handed ${twoHandedStrokes[0]} stroke gets +15 Counter and is safer in the Danger Zone, at the cost of some power and width.`
    : oneHandedStrokes.length
      ? oneHandedStrokes.length > 1
        ? ` The one-handed ${oneHandedStrokes.join(' and ')} strokes do not receive the two-handed +15 Counter bonus in the Danger Zone.`
        : ` The one-handed ${oneHandedStrokes[0]} stroke does not receive the two-handed +15 Counter bonus in the Danger Zone.`
      : '';
  let ratingNote = '';
  if (forehandDisplay !== null && backhandDisplay !== null) {
    const difference = Math.abs(forehandRating - backhandRating).toFixed(1);
    ratingNote = forehandRating === backhandRating
      ? ` Groundstroke ratings are even at ${forehandDisplay}.`
      : forehandDisplay === backhandDisplay
        ? ` Groundstroke ratings are almost even at ${forehandDisplay} each.`
      : forehandRating > backhandRating
        ? ` Groundstroke ratings: Forehand ${forehandDisplay} is ${difference} higher than Backhand ${backhandDisplay}.`
        : ` Groundstroke ratings: Backhand ${backhandDisplay} is ${difference} higher than Forehand ${forehandDisplay}.`;
  }
  if (!handUse.length && !ratingNote) return '';
  const handNote = handUse.length ? `This character uses ${handUse.join(' and ')}.` : '';
  return `${handNote}${setupNote}${ratingNote}`.trim();
}
