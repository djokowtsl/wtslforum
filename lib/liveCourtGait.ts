/**
 * Ground-locked stepping for the livestream players.
 *
 * The old gait swung the feet sideways at a fixed cadence (frame * 0.22) no
 * matter which way, or how far, the player actually moved, so forward and
 * backward running glided over planted feet. Here the step cycle advances by
 * the distance the rig really travelled, along the direction it travelled:
 * a planted foot moves backwards in the rig's frame at exactly the rig's
 * speed, so it stays put on the court.
 */

export type GaitState = {
  phase: number; // 0..1 step cycle of the "left" foot; the right foot is half a cycle later
  direction: [number, number]; // smoothed local travel direction (x, z), unit
  amount: number; // 0..1 how much the player is stepping (eases in/out)
  /** Cycle offset of the second foot: 0.5 running; nearer 0.3/0.7 for a side shuffle. */
  offset?: number;
  /** Extra half-width of the stance when shuffling sideways (metres). */
  spread?: number;
  /** Stride (half, metres, including `amount`) at the last update. */
  stride?: number;
  /** 0 = rally footwork (short quick steps) .. 1 = walking between points. */
  walking?: number;
};

export type GaitFoot = { x: number; z: number; lift: number };

/** Fraction of the cycle a foot spends planted. */
export const STANCE = 0.6;
/** Lateral reach of one foot from its stance position before the feet would cross (running pattern). */
export const MAX_LATERAL_REACH = 0.14;
/** Closest the feet come to each other sideways (metres, centre to centre). */
export const MIN_FOOT_GAP = 0.09;
/** Half-distance between the feet in the plain stance (the renderer's stanceHalfWidth). */
export const STANCE_HALF_WIDTH = 0.15;
const SIDE_SHUFFLE_OFFSET = 0.2;
const SIDE_SHUFFLE_SPREAD = 0.06;

/**
 * How far the second foot's position, minus the first's, can swing toward it
 * over a cycle, per unit stride, for a cycle offset (`toward` = +1 when the
 * travel direction points from the first foot to the second).
 */
const closingTable = (() => {
  const table: number[][] = [[], []];
  for (let i = 0; i <= 100; i++) {
    let low = Infinity, high = -Infinity;
    for (let j = 0; j < 240; j++) {
      const p = j / 240;
      const difference = footCycle(p + i / 100).along - footCycle(p).along;
      low = Math.min(low, difference);
      high = Math.max(high, difference);
    }
    table[0].push(-low);
    table[1].push(high);
  }
  return table;
})();

export function feetClosing(offset: number, directionX: number) {
  const normalized = ((offset % 1) + 1) % 1;
  const index = Math.round(normalized * 100);
  return Math.max(0.5, directionX >= 0 ? closingTable[0][index] : closingTable[1][index]);
}

export function newGaitState(): GaitState {
  return { phase: 0, direction: [0, 1], amount: 0 };
}

/**
 * Half stride (metres) for a running speed in m/s: half the distance a planted
 * foot sweeps under the body. One step cycle covers 2 * halfStride / STANCE.
 * `walking` (0..1) blends short, quick rally footwork with natural between-point
 * strides. Sideways the feet's room limits it further (see effectiveHalfStride).
 */
export function halfStride(speedMs: number, walking = 1) {
  const footwork = Math.min(0.42, Math.max(0.1, 0.1 + 0.11 * speedMs));
  const strides = Math.min(0.55, Math.max(0.1, 0.1 + 0.22 * speedMs));
  return footwork + (strides - footwork) * Math.max(0, Math.min(1, walking));
}

/** Planted: sweeps +1 -> -1 at constant rate. Swing: lifts and returns -1 -> +1. */
export function footCycle(phase: number) {
  const p = ((phase % 1) + 1) % 1;
  if (p < STANCE) return { along: 1 - (2 * p) / STANCE, lift: 0 };
  const s = (p - STANCE) / (1 - STANCE);
  const eased = s * s * (3 - 2 * s);
  return { along: -1 + 2 * eased, lift: Math.sin(Math.PI * s) };
}

/**
 * Advance the gait by one renderer update.
 * @param travel local-space displacement of the rig since the last update (x, z)
 * @param speedMs recorded running speed in m/s (for stride length)
 */
export function advanceGait(state: GaitState, travel: [number, number], speedMs: number) {
  const distance = Math.hypot(travel[0], travel[1]);
  let reversed = false;
  const moving = Math.min(1, Math.max(0, (speedMs - 0.2) / 0.6));
  state.amount += (moving - state.amount) * 0.25;
  if (distance > 1e-5) {
    const dx = travel[0] / distance, dz = travel[1] / distance;
    // A reversal (forward then straight back) passes through a standstill:
    // take the new direction at once; averaging opposite vectors never flips.
    // (Only for real movement: a near-standstill wobble must not flip the
    // stepping direction back and forth.)
    // Mirror the cycle too, so reversing does not throw either foot sideways.
    if (speedMs > 0.4 && dx * state.direction[0] + dz * state.direction[1] < -0.3) {
      reversed = true;
      state.direction = [dx, dz];
      state.phase = (((STANCE - state.phase) % 1) + 1) % 1;
      state.offset = 1 - (state.offset ?? 0.5);
    }
    const k = speedMs > 0.4 ? 0.35 : 0.08;
    const nx = state.direction[0] + (dx - state.direction[0]) * k;
    const nz = state.direction[1] + (dz - state.direction[1]) * k;
    const length = Math.hypot(nx, nz) || 1;
    state.direction = [nx / length, nz / length];
  }
  // Sideways, the trailing foot steps in toward the lead foot and the stance
  // widens a little. Change timing only while the second foot is airborne.
  const sideways = Math.min(1, Math.max(0, (Math.abs(state.direction[0]) - 0.45) / 0.4));
  const targetOffset = 0.5 - SIDE_SHUFFLE_OFFSET * sideways * Math.sign(state.direction[0]);
  const offset = state.offset ?? 0.5;
  const secondFootPhase = (((state.phase + offset) % 1) + 1) % 1;
  if (!reversed && (secondFootPhase >= STANCE || state.amount < 0.05)) {
    state.offset = offset + Math.max(-0.015, Math.min(0.015, targetOffset - offset));
  }
  const spread = state.spread ?? 0;
  state.spread = spread + (SIDE_SHUFFLE_SPREAD * sideways * state.amount - spread) * 0.08;
  const amplitude = effectiveHalfStride(speedMs, state.direction, state.offset, state.spread, state.walking ?? 1);
  // Re-time as stride changes so a planted foot stays on the court.
  const stride = amplitude * state.amount;
  const previousStride = state.stride ?? stride;
  if (previousStride > 1e-3 && stride > 1e-3 && Math.abs(stride - previousStride) > 1e-5) {
    const offset = state.offset ?? 0.5;
    const firstPhase = ((state.phase % 1) + 1) % 1;
    const secondPhase = (((state.phase + offset) % 1) + 1) % 1;
    const retime = (phase: number) => {
      const along = Math.max(-1, Math.min(1, footCycle(phase).along * previousStride / stride));
      const retimed = ((1 - along) * STANCE) / 2;
      return retimed;
    };
    if (firstPhase < STANCE) {
      state.phase = retime(firstPhase);
      // Both feet down: keep the second one put too, through its cycle offset.
      if (secondPhase < STANCE) {
        const wanted = (((retime(secondPhase) - state.phase) % 1) + 1) % 1;
        const next = offset + Math.max(-0.02, Math.min(0.02, wanted - offset));
        state.offset = Math.max(0.25, Math.min(0.75, next));
      }
    } else if (secondPhase < STANCE) {
      state.phase = (((state.phase + retime(secondPhase) - secondPhase) % 1) + 1) % 1;
    }
  }
  state.stride = stride;
  // Stance sweeps 2*amplitude over STANCE of a cycle: that rate equals ground speed.
  state.phase = (state.phase + (distance * STANCE) / (2 * amplitude)) % 1;
  return state;
}

export function effectiveHalfStride(
  speedMs: number,
  direction: [number, number],
  offset = 0.5,
  spread = 0,
  walking = 1,
) {
  const lateral = Math.abs(direction[0]);
  const base = halfStride(speedMs, walking);
  if (lateral <= 1e-3) return base;
  const room = 2 * (STANCE_HALF_WIDTH + spread) - MIN_FOOT_GAP;
  return Math.min(base, room / (feetClosing(offset, direction[0]) * lateral));
}

/** Foot offsets from each foot's stance position, in the rig's local frame. */
export function gaitFeet(state: GaitState, speedMs: number): [GaitFoot, GaitFoot] {
  const offset = state.offset ?? 0.5;
  const spread = state.spread ?? 0;
  const amplitude = effectiveHalfStride(speedMs, state.direction, offset, spread, state.walking ?? 1) * state.amount;
  const height = (0.05 + 0.025 * Math.min(4, speedMs)) * state.amount;
  return [0, offset].map((cycleOffset, foot) => {
    const { along, lift } = footCycle(state.phase + cycleOffset);
    return {
      // The first foot is on the -x side, the second on +x.
      x: state.direction[0] * amplitude * along + (foot === 0 ? -spread : spread),
      z: state.direction[1] * amplitude * along,
      lift: lift * height,
    };
  }) as [GaitFoot, GaitFoot];
}

/**
 * How far the return-of-serve ready stance applies: settles in while the
 * opponent prepares, holds through their contact (with a split-step), and
 * releases as the receiver starts moving to the ball.
 */
export function returnReadiness(framesToServe: number) {
  const s = (x: number, a: number, b: number) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  // framesToServe = serveFrame - frame (positive before the opponent's contact)
  return s(-framesToServe, -90, -60) * (1 - s(-framesToServe, 6, 16));
}

/** Split-step hop height (metres): a small unweighting timed to the server's contact. */
export function splitStepLift(framesToServe: number) {
  const t = (-framesToServe + 8) / 10; // airborne from 8 frames before contact to 2 after
  return t > 0 && t < 1 ? Math.sin(Math.PI * t) * 0.06 : 0;
}

/** Walking pace between points (m/s). */
export const WALK_SPEED = 1.5;

/** Seconds a walk must leave before the next serve. */
export const ARRIVAL_MARGIN = 1;

export type RepositionPlan = 'follow' | 'walk' | 'cut';

/**
 * How the rig should reach a recorded position it is not at yet.
 * - follow: normal rally movement (small differences between samples)
 * - walk: between points, walk there at walking pace, facing the way it goes
 * - cut: too far, or not enough time before the next serve: fade and place it
 */
export function planReposition(options: {
  distance: number;
  betweenPoints: boolean;
  secondsToNextServe: number;
  /** Already walking: keep walking all the way to the spot (no snap at the end). */
  walking?: boolean;
}): RepositionPlan {
  const { distance, betweenPoints, secondsToNextServe, walking } = options;
  if (walking && betweenPoints && distance > 0.02 && distance / WALK_SPEED <= secondsToNextServe) return 'walk';
  if (!Number.isFinite(distance) || distance <= 0.6) return 'follow';
  if (!betweenPoints) return distance > 3 ? 'cut' : 'follow';
  if (distance > 7) return 'cut';
  // Arrive at least a second before the serve, so the server can set up and the
  // receiver can settle into the return stance standing still, not mid-walk.
  if (distance / WALK_SPEED > secondsToNextServe - ARRIVAL_MARGIN) return 'cut';
  return 'walk';
}

/** Seconds after an unanswered last shot at which the rally counts as over. */
export const RALLY_OVER_KNOWN_SECONDS = 1.0;
export const RALLY_OVER_UNANSWERED_SECONDS = 1.8;

/**
 * How far the rally is over (0..1). TE4 can mark a point several seconds after
 * the last shot, so relax when the ball has passed the receiver, a known point-
 * end exists, or no live reply arrives.
 */
export function rallyOverWeight<E extends { frame: number; kind: string }>(
  events: E[],
  frame: number,
  frameRate: number,
  /** Known frame when the ball passed the player who had to return this shot. */
  ballPassed?: (shot: E) => number | undefined,
) {
  let low = 0, high = events.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (events[middle].frame <= frame) low = middle + 1; else high = middle;
  }
  let index = low - 1;
  while (index >= 0 && events[index].kind !== 'shot') {
    if (events[index].kind === 'point-end') return 1;
    index -= 1;
  }
  if (index < 0) return 0;
  const fps = Number.isFinite(frameRate) && frameRate > 0 ? frameRate : 1;
  const smooth = (value: number) => {
    const amount = Math.min(1, Math.max(0, value));
    return amount * amount * (3 - 2 * amount);
  };
  // The ball passed the player who had to return it: relax, even if TE4 later
  // logs his swing at a ball that has already gone by. Check the previous shot
  // too, because that unreachable swing can be logged as another "shot".
  if (ballPassed) {
    const passed = ballPassed(events[index]);
    if (passed !== undefined && passed <= frame) return smooth((frame - passed) / fps / 0.3);
    let previous = index - 1;
    while (previous >= 0 && events[previous].kind !== 'shot' && events[previous].kind !== 'point-end') {
      previous -= 1;
    }
    if (previous >= 0 && events[previous].kind === 'shot') {
      const previousPassed = ballPassed(events[previous]);
      if (previousPassed !== undefined && previousPassed <= events[index].frame) {
        return smooth((frame - previousPassed) / fps / 0.3);
      }
    }
  }
  const next = events[index + 1];
  if (next?.kind === 'shot') return 0;
  const delay = next?.kind === 'point-end'
    ? RALLY_OVER_KNOWN_SECONDS
    : RALLY_OVER_UNANSWERED_SECONDS;
  const since = (frame - events[index].frame) / fps;
  return smooth((since - delay) / 0.4);
}

/** True when the latest event at or before `frame` ended a point. */
export function isBetweenPoints(events: { frame: number; kind: string }[], frame: number) {
  let low = 0, high = events.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (events[middle].frame <= frame) low = middle + 1; else high = middle;
  }
  return low > 0 && events[low - 1].kind === 'point-end';
}

/**
 * A real change of ends follows a finished game, so the server changes. A side
 * switch in the recorded positions within the same server's game is not a
 * changeover and must not be labelled as one.
 */
export function isGameChange(
  events: { frame: number; kind: string; shotType?: string; player?: number }[],
  frame: number,
) {
  let previous: number | undefined, next: number | undefined;
  for (const event of events) {
    if (event.kind !== 'shot' || event.shotType !== 'serve' || !event.player) continue;
    if (event.frame <= frame) previous = event.player;
    else { next = event.player; break; }
  }
  return previous !== undefined && next !== undefined && previous !== next;
}

type CutEvent = { frame: number; kind: string; shotType?: string; player?: number; changeover?: boolean };

/**
 * Should a cut where a player's recorded end switches be labelled "Change of
 * ends"? Uses the point-end that the cut belongs to (the last one before it
 * with no serve since, else one just after it) and its score-based changeover
 * flag. Recordings without that flag fall back to "the server changes".
 */
export function isChangeoverCut(events: CutEvent[], frame: number) {
  let low = 0, high = events.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (events[middle].frame <= frame) low = middle + 1; else high = middle;
  }
  let owner: CutEvent | undefined;
  for (let i = low - 1; i >= 0; i--) {
    const event = events[i];
    if (event.kind === 'point-end') { owner = event; break; }
    if (event.kind === 'shot' && event.shotType === 'serve') break;
  }
  if (!owner) {
    for (let i = low; i < events.length && events[i].frame <= frame + 90; i++) {
      if (events[i].kind === 'point-end') { owner = events[i]; break; }
    }
  }
  if (typeof owner?.changeover === 'boolean') return owner.changeover;
  return isGameChange(events, frame);
}

/** This player's next shot after `frame`, if any. */
export function nextShotEvent<T extends { frame: number; kind: string; player?: number }>(
  events: T[],
  player: number,
  frame: number,
): T | undefined {
  let low = 0, high = events.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (events[middle].frame <= frame) low = middle + 1; else high = middle;
  }
  for (let i = low; i < events.length; i++) {
    if (events[i].kind === 'shot' && events[i].player === player) return events[i];
  }
  return undefined;
}

/** Frame of this player's most recent shot at or before `frame` (any distance back). */
export function lastShotFrame(
  events: { frame: number; kind: string; player?: number }[],
  player: number,
  frame: number,
) {
  let low = 0, high = events.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (events[middle].frame <= frame) low = middle + 1; else high = middle;
  }
  for (let i = low - 1; i >= 0; i--) {
    if (events[i].kind === 'shot' && events[i].player === player) return events[i].frame;
  }
  return undefined;
}

/**
 * Smoothed court position and velocity for a player (a "one euro" filter).
 * TE4's centimetre-quantized samples can jitter enough to shake the gait.
 */
export type PositionFilter = { x: number; z: number; vx: number; vz: number; tx?: number; tz?: number };

const lowPassAlpha = (cutoffHz: number, dt: number) => {
  const tau = 1 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + tau / dt);
};

export const POSITION_FILTER = {
  minCutoffHz: 0.6,
  beta: 4,
  trendCutoffHz: 1.5,
  deadZone: 0.6,
  velocityCutoffHz: 4,
};

export function filterCourtPosition(
  state: PositionFilter | undefined,
  x: number,
  z: number,
  dt: number,
): PositionFilter {
  if (!state || !Number.isFinite(dt) || dt > 0.5) return { x, z, vx: 0, vz: 0, tx: 0, tz: 0 };
  if (!(dt > 0)) return state;
  const trendAlpha = lowPassAlpha(POSITION_FILTER.trendCutoffHz, dt);
  const priorTx = state.tx ?? state.vx;
  const priorTz = state.tz ?? state.vz;
  const tx = priorTx + ((x - state.x) / dt - priorTx) * trendAlpha;
  const tz = priorTz + ((z - state.z) / dt - priorTz) * trendAlpha;
  const cutoff = POSITION_FILTER.minCutoffHz
    + POSITION_FILTER.beta * Math.max(0, Math.hypot(tx, tz) - POSITION_FILTER.deadZone);
  const alpha = lowPassAlpha(cutoff, dt);
  const nextX = state.x + (x - state.x) * alpha;
  const nextZ = state.z + (z - state.z) * alpha;
  const velocityAlpha = lowPassAlpha(POSITION_FILTER.velocityCutoffHz, dt);
  const vx = state.vx + ((nextX - state.x) / dt - state.vx) * velocityAlpha;
  const vz = state.vz + ((nextZ - state.z) / dt - state.vz) * velocityAlpha;
  return { x: nextX, z: nextZ, vx, vz, tx, tz };
}

/** Ease a value toward a target in replay time; seeks and long gaps jump. */
export function easeToward(previous: number | undefined, target: number, dt: number, seconds: number) {
  if (previous === undefined || !Number.isFinite(previous) || dt > 0.5) return target;
  if (!(dt > 0)) return previous;
  return previous + (target - previous) * (1 - Math.exp(-dt / seconds));
}
