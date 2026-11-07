import type { LiveCourtCoordinates, LiveCourtMotionEvent, LiveCourtSample } from './liveCourtMotion';

export const DMO_SMASH_CONTACT_HEIGHT_METERS = 2.25;
const SOURCE_CENTIMETRES_TO_METRES = 0.01;
const MAX_DISTANCE_FROM_NET_METERS = 4.2;
const MIN_INCOMING_LOB_APEX_METERS = 3.25;

/**
 * DMO identifies rallies, not lobs. Infer an overhead conservatively from the
 * incoming flight only; missing or ambiguous evidence keeps the normal stroke.
 * All source coordinates passed here are centimetres, not metres.
 */
export function isCapturedSmashShot(
  event: LiveCourtMotionEvent | undefined,
  contact: LiveCourtCoordinates | null | undefined,
  samples: LiveCourtSample[],
  events: LiveCourtMotionEvent[],
  framesPerSecond = 60,
): boolean {
  if (event?.kind !== 'shot' || event.shotType !== 'rally' || !event.player || !contact) return false;
  if (!contact.every(Number.isFinite) || !Number.isFinite(event.frame)) return false;
  const playerIndex = event.player === 1 ? 3 : 5;
  const height = contact[2] * SOURCE_CENTIMETRES_TO_METRES;
  if (height < DMO_SMASH_CONTACT_HEIGHT_METERS || height > 3.5) return false;
  if (Math.abs(contact[playerIndex] * SOURCE_CENTIMETRES_TO_METRES) > MAX_DISTANCE_FROM_NET_METERS) {
    return false;
  }
  if (Math.hypot(contact[0] - contact[playerIndex], contact[1] - contact[playerIndex + 1])
    * SOURCE_CENTIMETRES_TO_METRES > 2) return false;

  // The immediately preceding event must be the opponent's rally hit in this
  // point, never a serve, our own hit, or an event from the previous point.
  let eventLow = 0;
  let eventHigh = events.length;
  while (eventLow < eventHigh) {
    const middle = (eventLow + eventHigh) >> 1;
    if (events[middle].frame < event.frame) eventLow = middle + 1;
    else eventHigh = middle;
  }
  const incomingShot = events[eventLow - 1];
  if (incomingShot?.kind !== 'shot' || incomingShot.shotType !== 'rally'
    || !incomingShot.player || incomingShot.player === event.player) return false;
  const fps = Number.isFinite(framesPerSecond) && framesPerSecond > 0 ? framesPerSecond : 60;
  const flightFrames = event.frame - incomingShot.frame;
  if (flightFrames < fps * 0.35 || flightFrames > fps * 5) return false;

  let low = 0;
  let high = samples.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (samples[middle].frame < incomingShot.frame) low = middle + 1;
    else high = middle;
  }
  let count = 0;
  let previousFrame = incomingShot.frame;
  let peakHeight = -Infinity;
  let peakFrame = -Infinity;
  let descendingHeight: number | undefined;
  for (let index = low; index < samples.length && samples[index].frame < event.frame; index += 1) {
    const sample = samples[index];
    const sampleHeight = sample.values[2] * SOURCE_CENTIMETRES_TO_METRES;
    if (!Number.isFinite(sampleHeight) || sample.frame - previousFrame > fps * 0.25) return false;
    // An intervening bounce is not the incoming overhead lob being inferred.
    if (sampleHeight < 0.15) return false;
    previousFrame = sample.frame;
    count += 1;
    if (sampleHeight > peakHeight) {
      peakHeight = sampleHeight;
      peakFrame = sample.frame;
    }
    const beforeContact = event.frame - sample.frame;
    if (beforeContact >= fps * 0.06 && beforeContact <= fps * 0.2) {
      descendingHeight = sampleHeight;
    }
  }
  return count >= 4
    && event.frame - previousFrame <= fps * 0.25
    && peakHeight >= MIN_INCOMING_LOB_APEX_METERS
    && peakHeight >= height + 0.35
    && event.frame - peakFrame >= fps * 0.1
    && descendingHeight !== undefined
    && descendingHeight >= height + 0.1;
}
