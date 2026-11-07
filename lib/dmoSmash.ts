export const DMO_SMASH_CONTACT_HEIGHT_METERS = 2.25;

export function isCapturedSmashShot(
  shotType: 'serve' | 'rally' | undefined,
  ballHeightMeters: number | undefined,
) {
  return shotType === 'rally'
    && Number.isFinite(ballHeightMeters)
    && (ballHeightMeters ?? 0) >= DMO_SMASH_CONTACT_HEIGHT_METERS;
}
