import assert from 'node:assert/strict';
import test from 'node:test';
import {
  advanceGait, gaitFeet, newGaitState, returnReadiness, splitStepLift, MAX_LATERAL_REACH,
} from '../lib/liveCourtGait.ts';

function run(direction, speedMs, frames = 240, fps = 60) {
  const state = newGaitState();
  const step = speedMs / fps;
  let body = 0, worstSlip = 0, planted = 0, minSeparation = Infinity;
  let previous = null;
  for (let f = 0; f < frames; f++) {
    body += step;
    advanceGait(state, [direction[0] * step, direction[1] * step], speedMs);
    const feet = gaitFeet(state, speedMs);
    const world = feet.map(foot => ({
      along: body + foot.x * direction[0] + foot.z * direction[1],
      lift: foot.lift,
    }));
    minSeparation = Math.min(minSeparation, 0.30 + (feet[1].x - feet[0].x));
    if (previous && f > 60) for (let k = 0; k < 2; k++) {
      if (world[k].lift === 0 && previous[k].lift === 0) {
        planted++;
        worstSlip = Math.max(worstSlip, Math.abs(world[k].along - previous[k].along));
      }
    }
    previous = world;
  }
  return { worstSlip, planted, minSeparation, state };
}

for (const [name, direction] of [
  ['forwards', [0, 1]],
  ['backwards', [0, -1]],
  ['sideways', [1, 0]],
  ['diagonal', [Math.SQRT1_2, Math.SQRT1_2]],
]) {
  test(`planted feet do not slide while running ${name}`, () => {
    for (const speed of [1, 2.5, 4.5]) {
      const { worstSlip, planted, state } = run(direction, speed);
      assert.ok(state.amount > 0.95, 'gait engages when running');
      assert.ok(planted > 50, 'feet spend time planted');
      assert.ok(worstSlip < 0.002 * speed,
        `${name} @${speed} m/s: planted foot slid ${worstSlip.toFixed(4)} m in a frame`);
    }
  });
}

test('sideways steps shuffle instead of crossing the feet', () => {
  const { minSeparation } = run([1, 0], 4.5);
  assert.ok(minSeparation > -1e-9, `feet crossed: separation ${minSeparation.toFixed(3)} m`);
  assert.ok(minSeparation < 0.15, 'a fast shuffle should still bring the feet together');
  assert.ok(MAX_LATERAL_REACH > 0);
});

test('standing still settles both feet on the ground', () => {
  const state = newGaitState();
  for (let f = 0; f < 120; f++) advanceGait(state, [0, 0], 0);
  const feet = gaitFeet(state, 0);
  assert.ok(state.amount < 0.01);
  for (const foot of feet) assert.ok(Math.abs(foot.x) + Math.abs(foot.z) + foot.lift < 1e-3);
});

test('return stance settles before the serve, split-steps at contact, releases after', () => {
  assert.equal(returnReadiness(200), 0);
  assert.ok(returnReadiness(40) > 0.99);
  assert.ok(returnReadiness(0) > 0.99);
  assert.equal(returnReadiness(-30), 0);
  assert.equal(splitStepLift(20), 0);
  assert.ok(splitStepLift(3) > 0.03);
  assert.equal(splitStepLift(-5), 0);
});
