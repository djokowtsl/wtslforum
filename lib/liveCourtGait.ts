/**
 * Ground-locked stepping for the livestream players.
 *
 * The old gait swung the feet sideways at a fixed cadence regardless of how
 * far, or in which direction, the player moved. Advance the step cycle by the
 * distance actually travelled so a planted foot stays fixed on the court.
 */

export type GaitState = {
  phase: number;
  direction: [number, number];
  amount: number;
};

export type GaitFoot = { x: number; z: number; lift: number };

/** Fraction of the cycle a foot spends planted. */
export const STANCE = 0.6;
/** Lateral reach before a shuffle would cause the feet to cross. */
export const MAX_LATERAL_REACH = 0.14;

export function newGaitState(): GaitState {
  return { phase: 0, direction: [0, 1], amount: 0 };
}

/** Half stride (metres) for a running speed in m/s. */
export function halfStride(speedMs: number) {
  return Math.min(0.42, Math.max(0.1, 0.1 + 0.11 * speedMs));
}

/** Planted foot sweeps +1 to -1; swing foot lifts and returns. */
export function footCycle(phase: number) {
  const p = ((phase % 1) + 1) % 1;
  if (p < STANCE) return { along: 1 - (2 * p) / STANCE, lift: 0 };
  const s = (p - STANCE) / (1 - STANCE);
  const eased = s * s * (3 - 2 * s);
  return { along: -1 + 2 * eased, lift: Math.sin(Math.PI * s) };
}

/**
 * Advance one renderer update.
 * @param travel local-space displacement of the rig since the last update
 * @param speedMs recorded running speed in m/s
 */
export function advanceGait(state: GaitState, travel: [number, number], speedMs: number) {
  const distance = Math.hypot(travel[0], travel[1]);
  const moving = Math.min(1, Math.max(0, (speedMs - 0.2) / 0.6));
  state.amount += (moving - state.amount) * 0.25;
  if (distance > 1e-5) {
    const dx = travel[0] / distance, dz = travel[1] / distance;
    // Reverse immediately rather than averaging opposite directions.
    if (dx * state.direction[0] + dz * state.direction[1] < -0.3) state.direction = [dx, dz];
    const k = 0.35;
    const nx = state.direction[0] + (dx - state.direction[0]) * k;
    const nz = state.direction[1] + (dz - state.direction[1]) * k;
    const length = Math.hypot(nx, nz) || 1;
    state.direction = [nx / length, nz / length];
  }
  const amplitude = effectiveHalfStride(speedMs, state.direction);
  state.phase = (state.phase + (distance * STANCE) / (2 * amplitude)) % 1;
  return state;
}

export function effectiveHalfStride(speedMs: number, direction: [number, number]) {
  const lateral = Math.abs(direction[0]);
  const base = halfStride(speedMs);
  return lateral > 1e-3 ? Math.min(base, MAX_LATERAL_REACH / lateral) : base;
}

/** Foot offsets from each stance position, in the rig's local frame. */
export function gaitFeet(state: GaitState, speedMs: number): [GaitFoot, GaitFoot] {
  const amplitude = effectiveHalfStride(speedMs, state.direction) * state.amount;
  const height = (0.05 + 0.025 * Math.min(4, speedMs)) * state.amount;
  return [0, 0.5].map(offset => {
    const { along, lift } = footCycle(state.phase + offset);
    return {
      x: state.direction[0] * amplitude * along,
      z: state.direction[1] * amplitude * along,
      lift: lift * height,
    };
  }) as [GaitFoot, GaitFoot];
}

/** Return stance settles before serve contact and releases after it. */
export function returnReadiness(framesToServe: number) {
  const s = (x: number, a: number, b: number) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  return s(-framesToServe, -90, -60) * (1 - s(-framesToServe, 6, 16));
}

/** Small unweighting timed to the opponent's serve contact. */
export function splitStepLift(framesToServe: number) {
  const t = (-framesToServe + 8) / 10;
  return t > 0 && t < 1 ? Math.sin(Math.PI * t) * 0.06 : 0;
}

/** Walking pace between points (m/s). */
export const WALK_SPEED = 1.5;

export type RepositionPlan = 'follow' | 'walk' | 'cut';

/** Choose normal tracking, a physical walk, or a short editorial cut. */
export function planReposition(options: {
  distance: number;
  betweenPoints: boolean;
  secondsToNextServe: number;
  /** Keep a started walk continuous through its last half metre. */
  walking?: boolean;
}): RepositionPlan {
  const { distance, betweenPoints, secondsToNextServe, walking } = options;
  if (walking && betweenPoints && distance > 0.02 && distance / WALK_SPEED <= secondsToNextServe) return 'walk';
  if (!Number.isFinite(distance) || distance <= 0.6) return 'follow';
  if (!betweenPoints) return distance > 3 ? 'cut' : 'follow';
  if (distance > 7) return 'cut';
  if (distance / WALK_SPEED > secondsToNextServe - 0.4) return 'cut';
  return 'walk';
}

/** True when the latest event at or before `frame` ended a point. */
export function isBetweenPoints(events: { frame: number; kind: string }[], frame: number) {
  let low = 0, high = events.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (events[middle].frame <= frame) low = middle + 1;
    else high = middle;
  }
  return low > 0 && events[low - 1].kind === 'point-end';
}
