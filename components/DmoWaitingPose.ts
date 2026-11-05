import type { GroundstrokePlayback } from './DmoCapturedGroundstroke';

/** Nearby events are lookup buffers, not proof that a stroke is moving. */
export function isWaitingPose(
  playback: GroundstrokePlayback | undefined,
  phaseWeights: readonly number[],
) {
  return !(playback && playback.weight > 0) && !phaseWeights.some(weight => weight > 0);
}
