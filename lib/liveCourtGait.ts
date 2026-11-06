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
};

export type GaitFoot = { x: number; z: number; lift: number };

/** Fraction of the cycle a foot spends planted. */
export const STANCE = 0.6;
/** Lateral reach of one foot from its stance position before the feet would cross. */
export const MAX_LATERAL_REACH = 0.14;

export function newGaitState(): GaitState {
  return { phase: 0, direction: [0, 1], amount: 0 };
}

/** Half stride (metres) for a running speed in m/s. */
export function halfStride(speedMs: number) {
  return Math.min(0.42, Math.max(0.1, 0.1 + 0.11 * speedMs));
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
  const moving = Math.min(1, Math.max(0, (speedMs - 0.2) / 0.6));
  state.amount += (moving - state.amount) * 0.25;
  if (distance > 1e-5) {
    const dx = travel[0] / distance, dz = travel[1] / distance;
    // A reversal (forward then straight back) passes through a standstill:
    // take the new direction at once; averaging opposite vectors never flips.
    if (dx * state.direction[0] + dz * state.direction[1] < -0.3) state.direction = [dx, dz];
    const k = 0.35;
    const nx = state.direction[0] + (dx - state.direction[0]) * k;
    const nz = state.direction[1] + (dz - state.direction[1]) * k;
    const length = Math.hypot(nx, nz) || 1;
    state.direction = [nx / length, nz / length];
  }
  // Shorter steps sideways so the feet never cross: a quick shuffle instead.
  const amplitude = effectiveHalfStride(speedMs, state.direction);
  // Stance sweeps 2*amplitude over STANCE of a cycle: that rate equals ground speed.
  state.phase = (state.phase + (distance * STANCE) / (2 * amplitude)) % 1;
  return state;
}

export function effectiveHalfStride(speedMs: number, direction: [number, number]) {
  const lateral = Math.abs(direction[0]);
  const base = halfStride(speedMs);
  return lateral > 1e-3 ? Math.min(base, MAX_LATERAL_REACH / lateral) : base;
}

/** Foot offsets from each foot's stance position, in the rig's local frame. */
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

function smoothstep(value: number, edge0: number, edge1: number) {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Blend the relaxed side-carry in for recorded between-point walks. */
export function relaxedWalkCarryWeight(speedMs: number) {
  return smoothstep(speedMs, 0.5, 1.0);
}

/** Ease the server's baseline guard in before contact and out after contact. */
export function serveBaselineGuardWeight(frameDelta: number) {
  return smoothstep(frameDelta, -64, -40) * (1 - smoothstep(frameDelta, 2, 14));
}

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
