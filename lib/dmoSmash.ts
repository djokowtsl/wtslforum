import type { LiveCourtCoordinates, LiveCourtMotionEvent } from './liveCourtMotion';

export const DMO_SMASH_CONTACT_HEIGHT_METERS = 2.2;
const SOURCE_CENTIMETRES_TO_METRES = 0.01;

/**
 * A recorded smash is selected only for a rally contact at or above the
 * overhead height. The contact is in centimetres; court position, bounce
 * history, and incoming flight do not limit the selection.
 */
export function isCapturedSmashShot(
  event: LiveCourtMotionEvent | undefined,
  contact: LiveCourtCoordinates | null | undefined,
): boolean {
  if (event?.kind !== 'shot' || event.shotType !== 'rally' || !event.player || !contact) return false;
  if (!contact.every(Number.isFinite) || !Number.isFinite(event.frame)) return false;
  const height = contact[2] * SOURCE_CENTIMETRES_TO_METRES;
  return height >= DMO_SMASH_CONTACT_HEIGHT_METERS;
}
