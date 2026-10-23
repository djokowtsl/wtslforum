export type LiveCourtCoordinates = [number, number, number, number, number, number, number];
export type LiveCourtSample = { frame: number; values: LiveCourtCoordinates };
export type LiveCourtMotionEvent = {
  frame: number;
  kind: 'shot' | 'point-end';
  player?: 1 | 2;
  shotType?: 'serve' | 'rally';
  speedKmh?: number;
};

// The DMO court runs along X, with the net at X=0. Player-local +Z points
// toward the net; this keeps the right-handed model oriented consistently.
export function liveCourtFacingAngle(playerX: number): number {
  return Number.isFinite(playerX) && playerX > 0 ? -Math.PI / 2 : Math.PI / 2;
}

export function findPlayerShotEvent(
  events: LiveCourtMotionEvent[],
  player: 1 | 2,
  frame: number,
  tolerance = 6,
): LiveCourtMotionEvent | undefined {
  return events.find((event) =>
    event.kind === 'shot'
    && event.player === player
    && Math.abs(event.frame - frame) <= tolerance,
  );
}

export function clampPlayerCameraLateralPan(value: number, halfCourtWidth = 10.97 / 2): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-halfCourtWidth, Math.min(halfCourtWidth, value));
}

export function mergeLiveCourtSamples(
  previous: LiveCourtSample[],
  incoming: LiveCourtSample[],
  maxFrameSpan: number,
): LiveCourtSample[] {
  const byFrame = new Map<number, LiveCourtSample>();
  for (const sample of [...previous, ...incoming]) {
    if (
      Number.isInteger(sample.frame)
      && sample.frame >= 0
      && sample.values.length === 7
      && sample.values.every(Number.isFinite)
      && !byFrame.has(sample.frame)
    ) {
      byFrame.set(sample.frame, sample);
    }
  }

  const ordered = [...byFrame.values()].sort((a, b) => a.frame - b.frame);
  const latestFrame = ordered[ordered.length - 1]?.frame;
  if (latestFrame === undefined) return [];
  const cutoff = latestFrame - Math.max(0, Math.floor(maxFrameSpan));
  return ordered.filter((sample) => sample.frame >= cutoff);
}

export function mergeLiveCourtEvents(
  previous: LiveCourtMotionEvent[],
  incoming: LiveCourtMotionEvent[],
  earliestFrame: number,
): LiveCourtMotionEvent[] {
  const byKey = new Map<string, LiveCourtMotionEvent>();
  for (const event of [...previous, ...incoming]) {
    if (
      Number.isInteger(event.frame)
      && event.frame >= earliestFrame
      && (event.kind === 'shot' || event.kind === 'point-end')
    ) {
      byKey.set(`${event.frame}:${event.kind}`, event);
    }
  }
  return [...byKey.values()].sort((a, b) =>
    a.frame - b.frame || (a.kind === b.kind ? 0 : a.kind === 'shot' ? -1 : 1),
  );
}

export function advanceLiveCourtPlayhead(
  currentFrame: number | null,
  elapsedMs: number,
  speed: number,
  samples: LiveCourtSample[],
  framesPerSecond = 60,
): number | null {
  if (!samples.length) return null;
  const firstFrame = samples[0].frame;
  const lastFrame = samples[samples.length - 1].frame;
  const current = currentFrame === null || !Number.isFinite(currentFrame)
    ? firstFrame
    : Math.max(firstFrame, Math.min(lastFrame, currentFrame));
  const elapsed = Math.max(0, Math.min(80, Number.isFinite(elapsedMs) ? elapsedMs : 0));
  const safeSpeed = Math.max(0, Number.isFinite(speed) ? speed : 0);
  const safeFrameRate = Math.max(0, Number.isFinite(framesPerSecond) ? framesPerSecond : 0);
  const next = current + elapsed * safeFrameRate * safeSpeed / 1000;
  return Math.min(lastFrame, next);
}

export function interpolateLiveCourtFrame(
  samples: LiveCourtSample[],
  frame: number,
  maxGapFrames: number,
): LiveCourtCoordinates | null {
  if (!samples.length || !Number.isFinite(frame)) return null;
  if (frame <= samples[0].frame) return samples[0].values;
  const last = samples[samples.length - 1];
  if (frame >= last.frame) return last.values;

  let low = 0;
  let high = samples.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (samples[middle].frame <= frame) low = middle + 1;
    else high = middle - 1;
  }

  const before = samples[Math.max(0, high)];
  const after = samples[Math.min(samples.length - 1, low)];
  // Changeovers are editorial cuts. Interpolation would send both players
  // through the net, even before the renderer detects the changed ends.
  if ([3, 5].some(i => Math.abs(before.values[i]) > 100
    && Math.abs(after.values[i]) > 100
    && Math.sign(before.values[i]) !== Math.sign(after.values[i]))) {
    return after.values;
  }
  const span = after.frame - before.frame;
  if (span <= 0) return before.values;
  const safeMaxGapFrames = Number.isFinite(maxGapFrames) ? Math.max(1, maxGapFrames) : 1;
  if (span > safeMaxGapFrames) {
    const blendStart = after.frame - safeMaxGapFrames;
    if (frame <= blendStart) return before.values;
    const progress = Math.max(0, Math.min(1, (frame - blendStart) / safeMaxGapFrames));
    const blend = progress * progress * (3 - 2 * progress);
    return before.values.map((value, index) =>
      value + (after.values[index] - value) * blend,
    ) as LiveCourtCoordinates;
  }
  const blend = (frame - before.frame) / span;
  return before.values.map((value, index) =>
    value + (after.values[index] - value) * blend,
  ) as LiveCourtCoordinates;
}

export function latestLiveCourtMotionEvent(
  events: LiveCourtMotionEvent[],
  frame: number,
): LiveCourtMotionEvent | null {
  let low = 0;
  let high = events.length - 1;
  let match = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (events[middle].frame <= frame) {
      match = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return match >= 0 ? events[match] : null;
}
