export type LiveCourtCoordinates = [number, number, number, number, number, number, number];
export type LiveCourtSample = { frame: number; values: LiveCourtCoordinates };
export type LiveCourtMotionEvent = { frame: number; kind: 'shot' | 'point-end' };

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
  const span = after.frame - before.frame;
  if (span <= 0 || span > maxGapFrames) return before.values;
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
