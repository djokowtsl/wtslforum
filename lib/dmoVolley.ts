import type { LiveCourtCoordinates, LiveCourtMotionEvent, LiveCourtSample } from './liveCourtMotion';

/**
 * A near-net position is not a volley label. Require a complete, unbounced
 * incoming rally flight; ambiguous or sparse evidence retains a groundstroke.
 * Coordinates are source centimetres. This is an animation cue, not a statistic.
 */
/** How far from the net (m) a ball taken before its bounce is a volley. Up to
 *  the service line and a little behind: a player coming in volleys there
 *  too. (At 4.2 m, service-line volleys were played as groundstrokes: a
 *  one-hander's compact backhand passed for a volley, a two-hander's drive
 *  didn't.) The unbounced-flight check below still decides. */
export const VOLLEY_MAX_NET_DISTANCE = 8;

export function isCapturedVolleyShot(
  event: LiveCourtMotionEvent | undefined,
  contact: LiveCourtCoordinates | null | undefined,
  samples: LiveCourtSample[],
  events: LiveCourtMotionEvent[],
  sounds: Array<{ frame: number; kind: string }> = [],
  framesPerSecond = 60,
): boolean {
  if (event?.kind !== 'shot' || event.shotType !== 'rally' || !event.player || !contact) return false;
  if (!contact.every(Number.isFinite) || !Number.isFinite(event.frame)) return false;
  const playerIndex = event.player === 1 ? 3 : 5;
  const playerX = contact[playerIndex] * 0.01;
  const height = contact[2] * 0.01;
  if (Math.abs(playerX) > VOLLEY_MAX_NET_DISTANCE || height < 0.2 || height > 2.2) return false;
  if (contact[0] * playerX <= 0) return false;
  if (Math.hypot(contact[0] - contact[playerIndex], contact[1] - contact[playerIndex + 1]) * 0.01 > 1.8) {
    return false;
  }

  let low = 0;
  let high = events.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (events[middle].frame < event.frame) low = middle + 1;
    else high = middle;
  }
  const incoming = events[low - 1];
  // A direct volley return of serve is not legal; serve-and-volley is eligible
  // only after the opponent has made a rally return. Do not cross point ends.
  if (incoming?.kind !== 'shot' || incoming.shotType !== 'rally'
    || !incoming.player || incoming.player === event.player) return false;
  const fps = Number.isFinite(framesPerSecond) && framesPerSecond > 0 ? framesPerSecond : 60;
  const flightFrames = event.frame - incoming.frame;
  if (flightFrames < fps * 0.12 || flightFrames > fps * 3) return false;
  if (sounds.some(sound => sound.kind === 'bounce'
    && sound.frame > incoming.frame && sound.frame <= event.frame)) return false;

  low = 0;
  high = samples.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (samples[middle].frame < incoming.frame) low = middle + 1;
    else high = middle;
  }
  const maximumGap = fps * 0.12;
  let previousFrame = incoming.frame;
  let previousHeight: number | undefined;
  let previousVerticalSpeed: number | undefined;
  let previousBallX: number | undefined;
  let previousBallZ: number | undefined;
  let clearedNet = false;
  let count = 0;
  let firstBallX: number | undefined;
  const incomingSamples: LiveCourtSample[] = [];
  for (let index = low; index < samples.length && samples[index].frame < event.frame; index += 1) {
    incomingSamples.push(samples[index]);
  }
  // Include the interpolated contact as the terminal sample, not the outgoing
  // flight. This also checks the final interval when the hit is between samples.
  incomingSamples.push({ frame: event.frame, values: contact });
  for (const sample of incomingSamples) {
    if (!Number.isFinite(sample.frame) || !sample.values.every(Number.isFinite)) return false;
    const gap = sample.frame - previousFrame;
    if (gap > maximumGap || (count > 0 && gap <= 0)) return false;
    const ballHeight = sample.values[2] * 0.01;
    const ballX = sample.values[0] * 0.01;
    const ballZ = sample.values[1] * 0.01;
    if (ballHeight < 0.12) return false;
    firstBallX ??= sample.values[0] * 0.01;
    if (previousHeight !== undefined && gap > 0) {
      const speed = (ballHeight - previousHeight) * fps / gap;
      if (Math.hypot(ballX - previousBallX!, ballZ - previousBallZ!, ballHeight - previousHeight)
        * fps / gap > 80) return false;
      if (previousBallX! * ballX <= 0 && previousBallX !== ballX) {
        const fraction = -previousBallX! / (ballX - previousBallX!);
        if (previousHeight + (ballHeight - previousHeight) * fraction < 0.91) return false;
        clearedNet = true;
      }
      // Reject a bounce missed between samples: an incoming free flight cannot
      // change from descending to rising or gain upward velocity abruptly.
      if (previousVerticalSpeed !== undefined
        && ((previousVerticalSpeed < -0.3 && speed > 0.3)
          || speed - previousVerticalSpeed > 2)) return false;
      previousVerticalSpeed = speed;
    }
    previousHeight = ballHeight;
    previousBallX = ballX;
    previousBallZ = ballZ;
    previousFrame = sample.frame;
    count += 1;
  }
  return count >= 4
    && clearedNet
    && event.frame - previousFrame <= maximumGap
    && firstBallX !== undefined
    && firstBallX * playerX < 0;
}
