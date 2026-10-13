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

export function buildStrokeMechanicsInsight({
  playing_hand: playingHand,
  forehand_type: forehandType,
  backhand_type: backhandType,
} = {}) {
  const hand = playingHand === 'right' || playingHand === 'left'
    ? `${playingHand === 'right' ? 'Right' : 'Left'}-handed`
    : '';
  const forehand = forehandType === 'one-handed' || forehandType === 'two-handed'
    ? `${forehandType} forehand`
    : '';
  const backhand = backhandType === 'one-handed' || backhandType === 'two-handed'
    ? `${backhandType} backhand`
    : '';
  const setup = [hand, forehand, backhand].filter(Boolean).join(' · ');
  if (!setup) return '';

  const hasTwoHandedStroke =
    forehandType === 'two-handed' || backhandType === 'two-handed';
  if (!hasTwoHandedStroke) return setup;

  return `${setup}. Two-handed strikes are slightly less powerful and less wide-reaching (you need to get closer to the ball), but safer in the orange/red Danger Zone and add 15 Counter.`;
}
