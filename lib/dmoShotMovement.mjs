// When a player slides or stretches into a shot, worked out from the
// recording: how fast he ran in, how far the ball was from him at contact,
// whether he stopped hard, and the court surface. Pure; computed once per
// batch of samples, never per frame.

/** Seconds of running looked at before the contact. */
const APPROACH_SECONDS = 0.4;
/** Seconds after the contact in which a slide brakes. */
const BRAKE_SECONDS = 0.3;
/** After the contact his speed falls below this share of the run-in speed. */
const BRAKE_SHARE = 0.6;
/** Contacts closer to the net than this (m) are volleys or approaches, never slides. */
const SLIDE_MIN_DEPTH = 5;
/** A player doesn't slide again within this many seconds. */
export const DMO_SLIDE_COOLDOWN_SECONDS = 2.5;
/** Ball at least this far (m) from the player's centre at contact: a stretch. */
export const DMO_STRETCH_REACH = 1.45;

/**
 * Per surface: the run-in speed (m/s) and reach (m) a slide needs. Clay
 * slides on most hard-run wide balls; hard courts only flat out at full
 * stretch; grass never.
 */
export const DMO_SLIDE_RULES = Object.freeze({
  clay: Object.freeze({ speed: 3.8, reach: 1.0 }),
  hard: Object.freeze({ speed: 4.5, reach: 1.35 }),
  unknown: Object.freeze({ speed: 4.5, reach: 1.35 }),
  grass: null,
});

function sampleIndexAt(samples, frame) {
  let low = 0;
  let high = samples.length - 1;
  if (high < 0 || frame < samples[0].frame) return -1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (samples[middle].frame <= frame) low = middle;
    else high = middle - 1;
  }
  return low;
}

function playerAt(sample, player) {
  const values = sample.values;
  return player === 1 ? [values[3] * 0.01, values[4] * 0.01] : [values[5] * 0.01, values[6] * 0.01];
}

/**
 * Measures one shot: run-in speed (m/s), speed just after (m/s), reach to
 * the ball (m), ball height (m) and distance from the net (m). Null when the
 * samples around it are missing.
 */
export function measureDmoShot(samples, event, frameRate = 60) {
  if (!Array.isArray(samples) || !event || (event.player !== 1 && event.player !== 2)) return null;
  const fps = Number.isFinite(frameRate) && frameRate > 0 ? frameRate : 60;
  const contact = sampleIndexAt(samples, event.frame);
  const before = sampleIndexAt(samples, event.frame - APPROACH_SECONDS * fps);
  const after = sampleIndexAt(samples, event.frame + BRAKE_SECONDS * fps);
  if (contact < 0 || before < 0 || after <= contact || before >= contact) return null;
  const at = samples[contact];
  if (Math.abs(at.frame - event.frame) > fps * 0.2) return null;
  const [x, z] = playerAt(at, event.player);
  const [bx, bz] = playerAt(samples[before], event.player);
  const [ax, az] = playerAt(samples[after], event.player);
  const inSeconds = (at.frame - samples[before].frame) / fps;
  const outSeconds = (samples[after].frame - at.frame) / fps;
  if (!(inSeconds > 0) || !(outSeconds > 0)) return null;
  const values = at.values;
  const measured = {
    approachSpeed: Math.hypot(x - bx, z - bz) / inSeconds,
    speedAfter: Math.hypot(ax - x, az - z) / outSeconds,
    reach: Math.hypot(values[0] * 0.01 - x, values[1] * 0.01 - z),
    ballHeight: Math.max(0, values[2] * 0.01),
    depth: Math.abs(x),
  };
  return Object.values(measured).every(Number.isFinite) ? measured : null;
}

/** 'slide', 'stretch' or null for one measured shot on this surface. */
export function classifyDmoShotMovement(measured, surface = 'unknown') {
  if (!measured) return null;
  const rule = Object.hasOwn(DMO_SLIDE_RULES, surface) ? DMO_SLIDE_RULES[surface] : DMO_SLIDE_RULES.unknown;
  if (
    rule
    && measured.depth >= SLIDE_MIN_DEPTH
    && measured.approachSpeed >= rule.speed
    && measured.reach >= rule.reach
    && measured.speedAfter < measured.approachSpeed * BRAKE_SHARE
  ) return 'slide';
  if (measured.reach >= DMO_STRETCH_REACH) return 'stretch';
  return null;
}

/**
 * Every rally shot that is a slide or a stretch, in frame order:
 * { frame, player, kind, reach, ballHeight, approachSpeed }. Serves never
 * are. A player's slides are at least DMO_SLIDE_COOLDOWN_SECONDS apart (a
 * would-be slide inside that becomes a stretch if the reach is long enough).
 */
export function planDmoShotMovements(samples, events, { surface = 'unknown', frameRate = 60 } = {}) {
  if (!Array.isArray(samples) || !Array.isArray(events)) return [];
  const fps = Number.isFinite(frameRate) && frameRate > 0 ? frameRate : 60;
  const lastSlide = [-Infinity, -Infinity];
  const plan = [];
  const shots = events
    .filter((event) => event?.kind === 'shot' && event.shotType !== 'serve' && (event.player === 1 || event.player === 2))
    .sort((a, b) => a.frame - b.frame);
  for (const event of shots) {
    const measured = measureDmoShot(samples, event, fps);
    let kind = classifyDmoShotMovement(measured, surface);
    if (kind === 'slide' && event.frame - lastSlide[event.player - 1] < DMO_SLIDE_COOLDOWN_SECONDS * fps) {
      kind = measured.reach >= DMO_STRETCH_REACH ? 'stretch' : null;
    }
    if (!kind) continue;
    if (kind === 'slide') lastSlide[event.player - 1] = event.frame;
    plan.push({
      frame: event.frame,
      player: event.player,
      kind,
      reach: measured.reach,
      ballHeight: measured.ballHeight,
      approachSpeed: measured.approachSpeed,
    });
  }
  return plan;
}

/** The planned movement for this player's shot at this frame, if any. */
export function dmoShotMovementAt(plan, player, frame) {
  if (!Array.isArray(plan)) return null;
  return plan.find((entry) => entry.player === player && entry.frame === frame) ?? null;
}
