export type LiveCourtCoordinates = [number, number, number, number, number, number, number];
export type LiveCourtSample = { frame: number; values: LiveCourtCoordinates };
export const LOW_REACH_MAX_DROP = 0.3;
export const SLICE_MAX_DROP_RATE = 950;
export const LUNGE_FEET_APART = 1.1;
export const LUNGE_DROP = 0.24;

function smoothstep(value: number, low: number, high: number) {
  const amount = Math.max(0, Math.min(1, (value - low) / (high - low)));
  return amount * amount * (3 - 2 * amount);
}

/** Convert frame deltas to the captured-motion clock (60 frames per second). */
export function liveCourtReplayFrameScale(frameRate: number) {
  return Number.isFinite(frameRate) && frameRate > 0 ? 60 / frameRate : 1;
}

/** Enter the rally run carry at 2.2 m/s; release below 2.0 m/s to avoid flicker. */
export function nextLiveCourtCarryMode(
  previous: boolean,
  options: { walking: boolean; shotDue: boolean; strolling: number; speed: number; carryIntent?: number },
) {
  if (options.walking) return true;
  if (options.shotDue) return false;
  const strolling = Number.isFinite(options.strolling)
    ? Math.max(0, Math.min(1, options.strolling))
    : 0;
  const speed = Number.isFinite(options.speed) ? options.speed : 0;
  const running = speed >= (previous ? 2.0 : 2.2);
  const intent = Number.isFinite(options.carryIntent)
    ? Math.max(0, Math.min(1, options.carryIntent!))
    : Math.max(strolling, running ? 1 : 0);
  if (intent > 0.65) return true;
  if (intent < 0.35) return false;
  return previous;
}

/** Calibrated low-ball knee bend and wide-ball lunge in metres. */
export function lowReachDrop(heightMetres: number, reachMetres: number) {
  if (!Number.isFinite(heightMetres) || !Number.isFinite(reachMetres)) return 0;
  const low = 1 - smoothstep(heightMetres, 0.25, 0.5);
  return Math.min(LOW_REACH_MAX_DROP, 0.15 * low + LUNGE_DROP * lungeWeight(reachMetres));
}

/** How far into a full lunge a ball this far from the body centre takes him.
 * A true slice keeps half the lunge so its swing remains visible. */
export function lungeWeight(reachMetres: number, slice = false) {
  if (!Number.isFinite(reachMetres)) return 0;
  const weight = smoothstep(reachMetres, 1.45, 1.95) * (1 - smoothstep(reachMetres, 2.6, 3.0));
  return weight * (slice ? 0.5 : 1);
}

/**
 * Infer spin from the ball's vertical flight between contact and its first
 * bounce. The fit uses centimetre-valued DMO heights and frame-relative time.
 */
export function liveCourtShotSpin(
  samples: LiveCourtSample[],
  hitFrame: number,
  frameRate: number,
): 'slice' | 'topspin' | null {
  if (!Number.isFinite(hitFrame) || !(frameRate > 0) || !samples.length) return null;
  let first = 0, last = samples.length;
  while (first < last) {
    const middle = (first + last) >> 1;
    if (samples[middle].frame <= hitFrame) first = middle + 1;
    else last = middle;
  }
  const flight: Array<[number, number]> = [];
  let bounced = false;
  for (let index = first; index < samples.length; index += 1) {
    const seconds = (samples[index].frame - hitFrame) / frameRate;
    if (seconds > 2.5) break;
    if (index > first && (samples[index].frame - samples[index - 1].frame) / frameRate > 0.1) return null;
    const height = samples[index].values[2];
    const next = samples[index + 1]?.values[2];
    if (
      height < 25 && next !== undefined && next >= height
      && flight.length && height <= flight[flight.length - 1][1]
    ) {
      bounced = true;
      break;
    }
    if (seconds >= 0.03) flight.push([seconds, height]);
  }
  flight.pop();
  if (!bounced || flight.length < 8 || flight[flight.length - 1][0] - flight[0][0] < 0.35) return null;

  const meanTime = flight.reduce((sum, [time]) => sum + time, 0) / flight.length;
  const moments = [0, 0, 0, 0, 0];
  const heights = [0, 0, 0];
  for (const [timeValue, height] of flight) {
    const time = timeValue - meanTime;
    let power = 1;
    for (let exponent = 0; exponent <= 4; exponent += 1) {
      moments[exponent] += power;
      power *= time;
    }
    heights[0] += height;
    heights[1] += height * time;
    heights[2] += height * time * time;
  }
  const determinant3 = (matrix: number[][]) =>
    matrix[0][0] * (matrix[1][1] * matrix[2][2] - matrix[1][2] * matrix[2][1])
    - matrix[0][1] * (matrix[1][0] * matrix[2][2] - matrix[1][2] * matrix[2][0])
    + matrix[0][2] * (matrix[1][0] * matrix[2][1] - matrix[1][1] * matrix[2][0]);
  const matrix = [
    [moments[4], moments[3], moments[2]],
    [moments[3], moments[2], moments[1]],
    [moments[2], moments[1], moments[0]],
  ];
  const determinant = determinant3(matrix);
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) return null;
  const rightHand = [heights[2], heights[1], heights[0]];
  const quadratic = determinant3(matrix.map((row, index) =>
    [rightHand[index], row[1], row[2]])) / determinant;
  return -2 * quadratic < SLICE_MAX_DROP_RATE ? 'slice' : 'topspin';
}

/** Pre-serve ball bounces: two, each 0.55 s, ending 1.45 s before contact. */
export const SERVE_BOUNCES = 2;
export const SERVE_BOUNCE_SECONDS = 0.55;
export const SERVE_BOUNCE_END_SECONDS = 1.45;

/**
 * TE4 records the ball held still in the server's hand for ~2 s before the
 * toss; in the game itself he bounces it. Height factor at the given time, or
 * null outside the bounce interval. `heldSince` is seconds before contact.
 */
export function serveBounceHeight(secondsToContact: number, heldSince: number) {
  if (!Number.isFinite(secondsToContact) || !Number.isFinite(heldSince)) return null;
  const start = SERVE_BOUNCE_END_SECONDS + SERVE_BOUNCES * SERVE_BOUNCE_SECONDS;
  if (secondsToContact > start || secondsToContact < SERVE_BOUNCE_END_SECONDS) return null;
  const into = start - secondsToContact;
  const bounce = Math.floor(into / SERVE_BOUNCE_SECONDS);
  const bounceStart = start - bounce * SERVE_BOUNCE_SECONDS;
  if (bounceStart > heldSince) return null;
  const t = (into - bounce * SERVE_BOUNCE_SECONDS) / SERVE_BOUNCE_SECONDS;
  return Math.abs(Math.cos(Math.PI * t));
}

/** How long the recorded ball has been held still before `frame`. */
export function liveCourtBallHeldSeconds(
  samples: LiveCourtSample[],
  frame: number,
  frameRate: number,
  lookBack = 3,
) {
  if (!samples.length || !(frameRate > 0)) return 0;
  let index = samples.length - 1;
  while (index > 0 && samples[index].frame > frame) index--;
  const anchor = samples[index].values;
  let held = 0;
  for (let k = index; k >= 0; k--) {
    const v = samples[k].values;
    if (Math.abs(v[0] - anchor[0]) > 3 || Math.abs(v[1] - anchor[1]) > 3 || Math.abs(v[2] - anchor[2]) > 3) break;
    held = (frame - samples[k].frame) / frameRate;
    if (held >= lookBack) break;
  }
  return held;
}

/** How far beyond the receiver (cm) the ball must travel to count as past. */
export const BALL_PASSED_MARGIN_CM = 100;

/**
 * Find when the ball has gone more than 1 m past the player who would reply.
 * Only samples through `uptoFrame` are considered, so the same check works live.
 */
export function ballPassedReceiverFrame(
  samples: LiveCourtSample[],
  shotFrame: number,
  uptoFrame: number,
  receiverXIndex: 3 | 5,
) {
  if (!Number.isFinite(shotFrame) || !Number.isFinite(uptoFrame) || uptoFrame < shotFrame) return undefined;
  let low = 0, high = samples.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (samples[middle].frame <= shotFrame) low = middle + 1;
    else high = middle;
  }
  for (let index = low; index < samples.length && samples[index].frame <= uptoFrame; index += 1) {
    const ball = samples[index].values[0];
    const receiver = samples[index].values[receiverXIndex];
    if (!Number.isFinite(ball) || !Number.isFinite(receiver) || receiver === 0) continue;
    if (Math.sign(ball) === Math.sign(receiver) && Math.abs(ball) > Math.abs(receiver) + BALL_PASSED_MARGIN_CM) {
      return samples[index].frame;
    }
  }
  return undefined;
}

export type LiveCourtMotionEvent = {
  frame: number;
  kind: 'shot' | 'point-end';
  player?: 1 | 2;
  shotType?: 'serve' | 'rally';
  speedKmh?: number;
  /** point-end only: the players change ends before the next point (from the score). */
  changeover?: boolean;
  /** Live DMO only: false for a raw end marker that is not a completed scored point. */
  scoreEligible?: boolean;
  /** DMO replay only: exact umpire score call for this point. */
  scoreCall?: string;
};
export type LiveCourtFootworkEvent = {
  frame: number;
  kind: 'footstep' | 'slide';
  player: 1 | 2;
};

export type LiveCourtSkidMark = {
  frame: number;
  player: 1 | 2;
  x: number;
  z: number;
  heading: number;
  intensity: number;
};

/** Source-positioned marks can be replayed after a seek and retained across points. */
export function deriveLiveCourtSkidMarks(
  samples: LiveCourtSample[],
  events: LiveCourtFootworkEvent[],
  framesPerSecond = 60,
): LiveCourtSkidMark[] {
  const fps = Number.isFinite(framesPerSecond) && framesPerSecond > 0 ? framesPerSecond : 60;
  const marks: LiveCourtSkidMark[] = [];
  let sampleIndex = 1;
  for (const event of events) {
    if (event.kind !== 'slide') continue;
    while (sampleIndex < samples.length && samples[sampleIndex].frame < event.frame) sampleIndex += 1;
    const current = samples[sampleIndex];
    const before = samples[sampleIndex - 1];
    if (!current || !before || current.frame !== event.frame) continue;
    const seconds = (current.frame - before.frame) / fps;
    if (seconds <= 0 || seconds > 0.4) continue;
    const xIndex = event.player === 1 ? 3 : 5;
    const zIndex = xIndex + 1;
    const dx = (current.values[xIndex] - before.values[xIndex]) * 0.01;
    const dz = (current.values[zIndex] - before.values[zIndex]) * 0.01;
    const speed = Math.hypot(dx, dz) / seconds;
    if (speed < 1.5 || speed > 9) continue;
    marks.push({
      frame: event.frame, player: event.player,
      x: (before.values[xIndex] + current.values[xIndex]) * 0.005,
      z: (before.values[zIndex] + current.values[zIndex]) * 0.005,
      heading: Math.atan2(dz, dx), intensity: Math.min(1, speed / 6),
    });
  }
  return marks;
}

export type LiveCourtContactCue = 'standard' | 'low-contact' | 'close-net' | 'soft-touch';

/** The furthest distance from the net (m) for a pre-bounce volley cue. */
export const VOLLEY_MAX_DISTANCE = 8;
/** Higher contacts are overheads, not volleys. */
export const VOLLEY_MAX_HEIGHT = 2.2;

/**
 * Whether the ball reached the contact on the player's side without bouncing.
 * Reads only samples at or before the contact, so this also works for live feeds.
 */
export function takenBeforeBounce(
  samples: LiveCourtSample[],
  contactIndex: number,
  playerX: number,
  framesPerSecond: number,
) {
  const contact = samples[contactIndex];
  const side = Math.sign(playerX);
  if (!contact || side === 0 || Math.sign(contact.values[0]) !== side) return false;
  const fps = Number.isFinite(framesPerSecond) && framesPerSecond > 0
    ? framesPerSecond
    : 60;
  for (let index = contactIndex - 1; index >= 0; index -= 1) {
    const sample = samples[index];
    if ((contact.frame - sample.frame) / fps > 2.5) return false;
    if (Math.sign(sample.values[0]) !== side) return true;
    const height = sample.values[2];
    const beforeHeight = samples[index - 1]?.values[2];
    const afterHeight = samples[index + 1]?.values[2];
    if (
      height < 15
      || (
        height < 40
        && beforeHeight !== undefined
        && afterHeight !== undefined
        && beforeHeight > height
        && afterHeight > height
        && index + 1 < contactIndex
      )
    ) return false;
  }
  return false;
}

/**
 * DMO only identifies serves/rallies, not groundstroke technique. These are
 * conservative animation cues from the recorded ball/player positions, not
 * asserted slice, drop-shot, or volley labels.
 */
export function inferLiveCourtContactCue(
  event: Pick<LiveCourtMotionEvent, 'frame' | 'player' | 'shotType'>,
  samples: LiveCourtSample[],
  framesPerSecond = 60,
): LiveCourtContactCue {
  if (event.shotType === 'serve' || !event.player) return 'standard';
  let low = 0;
  let high = samples.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (samples[middle].frame < event.frame) low = middle + 1;
    else high = middle;
  }
  const after = samples[low];
  const before = samples[low - 1];
  const nearest = !before ? after
    : !after ? before
      : event.frame - before.frame <= after.frame - event.frame ? before : after;
  const nearestDistance = nearest ? Math.abs(nearest.frame - event.frame) : Number.POSITIVE_INFINITY;
  // Do not infer technique across sparse gaps or from unrelated samples.
  if (!nearest || nearestDistance > 3) return 'standard';
  const playerXIndex = event.player === 1 ? 3 : 5;
  const playerX = nearest.values[playerXIndex] * 0.01;
  const ballY = Math.max(0, nearest.values[2] * 0.01);
  // `low` is the first sample at/after the hit. For a non-exact hit frame,
  // use the preceding sample so volley classification never reads ahead.
  const contactIndex = samples[low]?.frame === event.frame ? low : low - 1;
  const contactSample = samples[contactIndex];
  const contactPlayerX = contactSample
    ? contactSample.values[playerXIndex] * 0.01
    : Number.NaN;
  const contactBallY = contactSample
    ? Math.max(0, contactSample.values[2] * 0.01)
    : Number.NaN;
  if (Math.abs(playerX) <= 4.2) return 'close-net';
  // Service-line volleys count only when the ball has reached this side without
  // bouncing; baseline samples can miss a bounce, and high contacts are overheads.
  if (
    Number.isFinite(contactPlayerX)
    && Math.abs(contactPlayerX) <= VOLLEY_MAX_DISTANCE
    && contactBallY <= VOLLEY_MAX_HEIGHT
    && takenBeforeBounce(samples, contactIndex, contactPlayerX, framesPerSecond)
  ) return 'close-net';
  if (ballY <= 0.72) return 'low-contact';
  const following = samples[contactIndex + 1];
  const frameRate = Number.isFinite(framesPerSecond) && framesPerSecond > 0
    ? framesPerSecond
    : 60;
  if (
    nearest.frame === event.frame
    && following
    && following.frame > event.frame
    && following.frame - event.frame <= 8
  ) {
    const flightSeconds = (following.frame - event.frame) / frameRate;
    const outgoingSpeed = Math.hypot(
      (following.values[0] - nearest.values[0]) * 0.01,
      (following.values[1] - nearest.values[1]) * 0.01,
      (following.values[2] - nearest.values[2]) * 0.01,
    ) / flightSeconds;
    // A gentle, short ball flight suggests a soft-touch animation. It does
    // not establish a drop shot because the source has no technique labels.
    if (Number.isFinite(outgoingSpeed) && outgoingSpeed < 5.5 && ballY <= 1.2) return 'soft-touch';
  }
  return 'standard';
}

export function liveCourtTrajectoryCue(
  event: Pick<LiveCourtMotionEvent, 'kind' | 'shotType'>,
  gruntsEnabled: boolean,
): 'grunt' | 'cheer' | null {
  if (event.kind === 'point-end') return 'cheer';
  return event.shotType === 'rally' && gruntsEnabled ? 'grunt' : null;
}

export function deriveLiveCourtFootworkEvents(
  samples: LiveCourtSample[],
  framesPerSecond = 60,
): LiveCourtFootworkEvent[] {
  const frameRate = Number.isFinite(framesPerSecond) && framesPerSecond > 0
    ? framesPerSecond
    : 60;
  const lastFootstep = [-Infinity, -Infinity];
  const lastSlide = [-Infinity, -Infinity];
  const events: LiveCourtFootworkEvent[] = [];

  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    const frameGap = current.frame - previous.frame;
    if (frameGap <= 0 || frameGap > frameRate * 1.5) continue;
    const seconds = frameGap / frameRate;

    for (let player = 0; player < 2; player += 1) {
      const xIndex = player === 0 ? 3 : 5;
      const zIndex = player === 0 ? 4 : 6;
      const lateral = (current.values[zIndex] - previous.values[zIndex]) * 0.01;
      const length = (current.values[xIndex] - previous.values[xIndex]) * 0.01;
      const distance = Math.hypot(length, lateral);
      const speed = distance / seconds;
      if (distance > seconds * 7.5 || speed < 1.25) continue;

      const lateralRatio = distance > 0 ? Math.abs(lateral) / distance : 0;
      const next = samples[index + 1];
      const nextSeconds = next ? (next.frame - current.frame) / frameRate : 0;
      const nextLateral = next ? (next.values[zIndex] - current.values[zIndex]) * 0.01 : 0;
      const nextLength = next ? (next.values[xIndex] - current.values[xIndex]) * 0.01 : 0;
      const nextDistance = Math.hypot(nextLength, nextLateral);
      const nextSpeed = nextSeconds > 0 ? nextDistance / nextSeconds : speed;
      const braking = nextSeconds > 0 && nextSeconds <= 0.3
        && nextSpeed < speed * 0.58;
      const turning = nextSeconds > 0 && nextSeconds <= 0.3 && nextDistance > 0.01
        && (length * nextLength + lateral * nextLateral) / (distance * nextDistance) < 0.45;
      if (
        speed >= 2.2
        && (lateralRatio >= 0.78 || braking || turning)
        && current.frame - lastSlide[player] >= frameRate * 0.75
      ) {
        events.push({ frame: current.frame, kind: 'slide', player: (player + 1) as 1 | 2 });
        lastSlide[player] = current.frame;
        lastFootstep[player] = current.frame;
      } else if (current.frame - lastFootstep[player] >= frameRate * 0.27) {
        events.push({ frame: current.frame, kind: 'footstep', player: (player + 1) as 1 | 2 });
        lastFootstep[player] = current.frame;
      }
    }
  }

  return events.sort((first, second) =>
    first.frame - second.frame || first.kind.localeCompare(second.kind),
  );
}

export function liveCourtSlideWeight(
  events: LiveCourtFootworkEvent[],
  player: 1 | 2,
  frame: number,
  framesPerSecond = 60,
): number {
  if (!Number.isFinite(frame)) return 0;
  const frameRate = Number.isFinite(framesPerSecond) && framesPerSecond > 0
    ? framesPerSecond
    : 60;
  const duration = Math.max(1, frameRate * 0.42);
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.frame > frame || event.player !== player || event.kind !== 'slide') continue;
    const age = frame - event.frame;
    // Eases in over ~0.1 s: starting at full strength dropped the hips ~10 cm
    // and spread the feet in a single frame at the start of every slide.
    if (age <= duration) {
      const onset = Math.min(1, age / Math.max(1, frameRate * 0.1));
      return onset * onset * (3 - 2 * onset) * Math.max(0, 1 - age / duration);
    }
  }
  return 0;
}

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
  shotType?: 'serve' | 'rally',
): LiveCourtMotionEvent | undefined {
  const broadTolerance = shotType ? tolerance : Math.max(tolerance, 24);
  let low = 0;
  let high = events.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (events[middle].frame < frame - broadTolerance) low = middle + 1;
    else high = middle;
  }
  let nearest: LiveCourtMotionEvent | undefined;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (let index = low; index < events.length && events[index].frame <= frame + broadTolerance; index += 1) {
    const event = events[index];
    const allowedTolerance = shotType
      ? tolerance
      : event.shotType === 'serve' ? Math.max(tolerance, 24) : tolerance;
    const distance = Math.abs(event.frame - frame);
    if (
      event.kind === 'shot'
      && event.player === player
      && (!shotType || event.shotType === shotType)
      && distance <= allowedTolerance
      && distance < nearestDistance
    ) {
      nearest = event;
      nearestDistance = distance;
    }
  }
  return nearest;
}

export function findLiveCourtShotInRange(
  events: LiveCourtMotionEvent[],
  firstFrame: number,
  lastFrame: number,
  shotType?: 'serve' | 'rally',
): LiveCourtMotionEvent | undefined {
  const start = Math.min(firstFrame, lastFrame);
  const end = Math.max(firstFrame, lastFrame);
  let low = 0;
  let high = events.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (events[middle].frame < start) low = middle + 1;
    else high = middle;
  }
  for (let index = low; index < events.length && events[index].frame <= end; index += 1) {
    const event = events[index];
    if (event.kind === 'shot' && (!shotType || event.shotType === shotType)) return event;
  }
  return undefined;
}

export function latestLiveCourtShotEvent(
  events: LiveCourtMotionEvent[],
  frame: number,
): LiveCourtMotionEvent | null {
  let low = 0;
  let high = events.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (events[middle].frame <= frame) low = middle + 1;
    else high = middle;
  }
  for (let index = low - 1; index >= 0; index -= 1) {
    if (events[index].kind === 'shot') return events[index];
  }
  return null;
}

export function liveCourtEventsBetween(
  events: LiveCourtMotionEvent[],
  afterFrame: number,
  throughFrame: number,
): LiveCourtMotionEvent[] {
  let low = 0;
  let high = events.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (events[middle].frame <= afterFrame) low = middle + 1;
    else high = middle;
  }
  const result: LiveCourtMotionEvent[] = [];
  for (let index = low; index < events.length && events[index].frame <= throughFrame; index += 1) {
    result.push(events[index]);
  }
  return result;
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

/** Keep player repositioning active after a point until the next serve begins. */
export function isLiveCourtBetweenPoints(events: LiveCourtMotionEvent[], frame: number): boolean {
  if (!Number.isFinite(frame)) return false;
  let latestPointEnd = Number.NEGATIVE_INFINITY;
  for (const event of events) {
    if (event.kind === 'point-end' && event.frame <= frame) {
      latestPointEnd = Math.max(latestPointEnd, event.frame);
    }
  }
  if (!Number.isFinite(latestPointEnd)) return false;
  return !events.some(event =>
    event.kind === 'shot'
    && event.shotType === 'serve'
    && event.frame > latestPointEnd
    && event.frame <= frame,
  );
}

/** Move a player toward a recorded position without exceeding a physical step. */
export function advanceLiveCourtPlayerPosition(
  current: readonly [number, number],
  target: readonly [number, number],
  maximumDistance: number,
): [number, number] {
  const dx = target[0] - current[0];
  const dz = target[1] - current[1];
  const distance = Math.hypot(dx, dz);
  const limit = Number.isFinite(maximumDistance) ? Math.max(0, maximumDistance) : 0;
  if (distance <= limit || distance < 1e-8) return [target[0], target[1]];
  const fraction = limit / distance;
  return [current[0] + dx * fraction, current[1] + dz * fraction];
}

/** Singles court half-length and half-width (cm), and the margin for calling
 *  a bounce out. */
const COURT_HALF_LENGTH_CM = 1188.5;
const COURT_HALF_WIDTH_CM = 411.5;
const SERVICE_LINE_CM = 640;
const OUT_MARGIN_CM = 15;
/** A ball passing this far (m) to the side of a player is one he stretches for
 *  (closer, TE4 would have had him play it). Further than the max, a stretch
 *  couldn't get the racket near it (arm and racket ~1.3 m from the body
 *  centre, plus one long step), so he lets it go. */
export const REACH_ATTEMPT_MIN_METRES = 0.8;
export const REACH_ATTEMPT_MAX_METRES = 2;
/** Above this (m) as it passes him, he doesn't swing at it. */
export const REACH_ATTEMPT_MAX_HEIGHT = 1.9;
/** Moving away from the ball faster than this (m/s) just before it passes:
 *  he'd given up on it, no stretch. */
const REACH_ATTEMPT_MAX_AWAY_SPEED = 0.5;

export type ReachAttemptEvent = LiveCourtMotionEvent & { attempt: true };

/**
 * Adds the player's attempt at a ball that goes past him. TE4
 * logs no shot for a winner, so the beaten player just watched it go by; now
 * he stretches and swings at it as it passes, a "shot" with `attempt: true` at
 * the frame the ball goes past him. A ball he could have reached (closer than
 * REACH_ATTEMPT_MIN_METRES), one far out of reach, an overhead, a ball that
 * bounced out, and a serve fault (followed by another serve) get none. A swing
 * TE4 logs after the ball has already gone past him is replaced by the attempt.
 * Only for the players' motion: sounds, callouts and the score use the
 * recorded events.
 */
export function withReachAttempts(
  events: LiveCourtMotionEvent[], samples: LiveCourtSample[], frameRate: number,
  /** Live: the newest frame received. A ball has to have gone past him at
   *  least 0.3 s before it, so his reply (if he played it) or where it lands
   *  has arrived too. */
  dataEndFrame = Number.POSITIVE_INFINITY,
): LiveCourtMotionEvent[] {
  if (!samples.length || !(frameRate > 0)) return events;
  const out: LiveCourtMotionEvent[] = [];
  const dropped = new Set<LiveCourtMotionEvent>();
  const added: ReachAttemptEvent[] = [];
  for (let i = 0; i < events.length; i++) {
    const shot = events[i];
    if (shot.kind !== 'shot' || !shot.player) continue;
    const receiver: 1 | 2 = shot.player === 1 ? 2 : 1;
    const xIndex = receiver === 1 ? 3 : 5, yIndex = receiver === 1 ? 4 : 6;
    const next = events[i + 1];
    if (shot.shotType === 'serve' && next?.kind === 'shot' && next.shotType === 'serve' && next.player === shot.player) continue; // a fault
    let low = 0, high = samples.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (samples[middle].frame <= shot.frame) low = middle + 1; else high = middle;
    }
    let crossing: { frame: number; side: number; height: number; toward: number } | undefined;
    let out = false;
    let bounced = false;
    for (let k = low; k < samples.length; k++) {
      const v = samples[k].values;
      if ((samples[k].frame - shot.frame) / frameRate > 2.5) break;
      if (k > low && (samples[k].frame - samples[k - 1].frame) / frameRate > 0.15) break;
      const ball = v[0], player = v[xIndex];
      if (!Number.isFinite(player) || player === 0) break;
      const previous = samples[k - 1]?.values[2], following = samples[k + 1]?.values[2];
      // Its first bounce on his side (before or after it passes him) says in
      // or out; he lets a ball going out go.
      if (!bounced && Math.sign(ball) === Math.sign(player) && v[2] < 25 && previous !== undefined
        && following !== undefined && previous > v[2] && following >= v[2]) {
        bounced = true;
        // (A serve has to land in the service box: a double fault isn't an ace.)
        const length = shot.shotType === 'serve' ? SERVICE_LINE_CM : COURT_HALF_LENGTH_CM;
        out = Math.abs(ball) > length + OUT_MARGIN_CM || Math.abs(v[1]) > COURT_HALF_WIDTH_CM + OUT_MARGIN_CM;
      }
      if (!crossing && Math.sign(ball) === Math.sign(player) && Math.abs(ball) >= Math.abs(player)) {
        // His sideways speed toward the ball over the last 0.3 s (m/s).
        let earlier = k;
        while (earlier > low && (samples[k].frame - samples[earlier - 1].frame) / frameRate <= 0.3) earlier--;
        const seconds = (samples[k].frame - samples[earlier].frame) / frameRate;
        const side = (v[1] - v[yIndex]) / 100;
        const toward = seconds > 0
          ? (v[yIndex] - samples[earlier].values[yIndex]) / 100 / seconds * Math.sign(side) : 0;
        crossing = { frame: samples[k].frame, side, height: v[2] / 100, toward };
      }
      if (out || (crossing && bounced) || (crossing && (samples[k].frame - crossing.frame) / frameRate > 1.5)) break;
    }
    if (out || !crossing) continue;
    if (crossing.frame > dataEndFrame - frameRate * 0.3) continue;
    // His reply (or TE4's late swing at a ball already gone).
    if (next?.kind === 'shot' && next.player === receiver) {
      if (next.frame <= crossing.frame + 3) continue; // he played it
      dropped.add(next);
    }
    const distance = Math.abs(crossing.side);
    if (distance < REACH_ATTEMPT_MIN_METRES || distance > REACH_ATTEMPT_MAX_METRES
      || crossing.height > REACH_ATTEMPT_MAX_HEIGHT || crossing.toward < -REACH_ATTEMPT_MAX_AWAY_SPEED) {
      dropped.delete(next!);
      continue;
    }
    added.push({ frame: crossing.frame, kind: 'shot', player: receiver, shotType: 'rally', attempt: true });
  }
  if (!added.length) return events;
  for (const event of events) if (!dropped.has(event)) out.push(event);
  out.push(...added);
  return out.sort((a, b) => a.frame - b.frame);
}

export function clampLiveCourtPlayheadToTail(
  currentFrame: number | null,
  samples: LiveCourtSample[],
  tailBufferFrames = 0,
): number | null {
  if (!samples.length || currentFrame === null || !Number.isFinite(currentFrame)) return null;
  const firstFrame = samples[0].frame;
  const lastFrame = samples[samples.length - 1].frame;
  const buffer = Number.isFinite(tailBufferFrames) ? Math.max(0, Math.floor(tailBufferFrames)) : 0;
  const playbackEnd = Math.max(firstFrame, lastFrame - buffer);
  return Math.max(firstFrame, Math.min(playbackEnd, currentFrame));
}

/** Live: how far (s) playback aims to stay behind the newest frame received,
 *  so a ball going past a player is known in time for him to stretch for it.
 *  Soft: after a late upload eats into it, playback slows to
 *  LIVE_CUSHION_REBUILD_SPEED until the gap is back. (The hard floor is the
 *  tail buffer, one DMO update interval, which bounce/Out calls need.) */
export const LIVE_CUSHION_SECONDS = 2;
/** Playback speed while the cushion rebuilds after a late upload. */
export const LIVE_CUSHION_REBUILD_SPEED = 0.8;

export function advanceLiveCourtPlayhead(
  currentFrame: number | null,
  elapsedMs: number,
  speed: number,
  samples: LiveCourtSample[],
  framesPerSecond = 60,
  /** Hard floor: never closer than this to the newest frame. */
  tailBufferFrames = 0,
  /** Soft target (frames behind the newest one, measured from the newest
   *  frame, not from the tail buffer, so the two don't add up): while closer
   *  than this, playback runs at LIVE_CUSHION_REBUILD_SPEED. 0 = off. */
  cushionFrames = 0,
): number | null {
  if (!samples.length) return null;
  const firstFrame = samples[0].frame;
  const lastFrame = samples[samples.length - 1].frame;
  const current = clampLiveCourtPlayheadToTail(
    currentFrame === null || !Number.isFinite(currentFrame) ? firstFrame : currentFrame,
    samples,
    tailBufferFrames,
  ) ?? firstFrame;
  const elapsed = Math.max(0, Math.min(80, Number.isFinite(elapsedMs) ? elapsedMs : 0));
  const safeSpeed = Math.max(0, Number.isFinite(speed) ? speed : 0);
  const safeFrameRate = Math.max(0, Number.isFinite(framesPerSecond) ? framesPerSecond : 0);
  const cushion = Number.isFinite(cushionFrames) ? Math.max(0, cushionFrames) : 0;
  const rebuilding = cushion > 0 && lastFrame - current < cushion;
  const next = current + elapsed * safeFrameRate * safeSpeed * (rebuilding ? LIVE_CUSHION_REBUILD_SPEED : 1) / 1000;
  return clampLiveCourtPlayheadToTail(next, samples, tailBufferFrames);
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
