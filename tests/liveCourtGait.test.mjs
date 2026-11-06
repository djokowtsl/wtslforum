import assert from 'node:assert/strict';
import test from 'node:test';
import {
  advanceGait, freeArmStrideSwing, gaitFeet, isChangeoverCut, newGaitState, nextShotEvent,
  lastShotFrame, returnReadiness, smoothReplayValue, splitStepLift, MAX_LATERAL_REACH,
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

test('return stance stays upright while moving and settles after stopping', async () => {
  const { returnSettleTarget, advanceReturnSettle } = await import('../lib/liveCourtGait.ts');
  assert.equal(returnSettleTarget(0.2, true), 0);
  assert.equal(returnSettleTarget(1.2, false), 0);
  assert.equal(returnSettleTarget(0.2, false), 1);
  assert.ok(advanceReturnSettle(0.8, 0.2, true, 1 / 60) < 0.8,
    'a moving player should begin standing up immediately');
  assert.ok(advanceReturnSettle(0, 0.2, false, 0.1) > 0,
    'settling into the stance should ease in after movement stops');
  assert.ok(advanceReturnSettle(1, 1.2, false, 1 / 60) < 0.9,
    'the stance should release quickly when the player moves off');
});

test('between points a player walks nearby and cuts to distant positions', async () => {
  const { planReposition, isBetweenPoints, WALK_SPEED } = await import('../lib/liveCourtGait.ts');
  assert.equal(planReposition({ distance: 0.3, betweenPoints: true, secondsToNextServe: 10 }), 'follow');
  assert.equal(planReposition({ distance: 3, betweenPoints: true, secondsToNextServe: 10 }), 'walk');
  assert.equal(planReposition({
    distance: 3, betweenPoints: true, secondsToNextServe: 3 / WALK_SPEED,
  }), 'cut');
  assert.equal(planReposition({ distance: 3, betweenPoints: true, secondsToNextServe: 3 }), 'walk');
  assert.equal(planReposition({ distance: 3, betweenPoints: true, secondsToNextServe: 2.9 }), 'cut');
  assert.equal(planReposition({ distance: 9, betweenPoints: true, secondsToNextServe: 30 }), 'cut');
  assert.equal(planReposition({ distance: 1.2, betweenPoints: false, secondsToNextServe: 30 }), 'follow');
  assert.equal(planReposition({ distance: 5, betweenPoints: false, secondsToNextServe: 30 }), 'cut');
  const events = [{ frame: 10, kind: 'shot' }, { frame: 50, kind: 'point-end' }, { frame: 90, kind: 'shot' }];
  assert.equal(isBetweenPoints(events, 40), false);
  assert.equal(isBetweenPoints(events, 50), true);
  assert.equal(isBetweenPoints(events, 89), true);
  assert.equal(isBetweenPoints(events, 90), false);
});

test('an in-progress walk continues to the target instead of snapping at the end', async () => {
  const { planReposition } = await import('../lib/liveCourtGait.ts');
  assert.equal(planReposition({
    distance: 0.4, betweenPoints: true, secondsToNextServe: 5, walking: true,
  }), 'walk');
  assert.equal(planReposition({
    distance: 1.65, betweenPoints: true, secondsToNextServe: 2, walking: true,
  }), 'cut', 'an ongoing walk must still leave one second before serve');
  assert.equal(planReposition({
    distance: 0.01, betweenPoints: true, secondsToNextServe: 5, walking: true,
  }), 'follow');
});

test('noisy speed samples cannot flip carry style, while a sustained sprint is followed', () => {
  let speed = 1.5;
  let carry = 0.2;
  const values = [];
  for (let frame = 0; frame < 18; frame += 1) {
    const noisySpeed = frame % 2 === 0 ? 0.4 : 3.4;
    speed = smoothReplayValue(speed, noisySpeed, 1 / 60, 0.15);
    const target = speed > 3.2 ? 1 : 0;
    carry = smoothReplayValue(carry, target, 1 / 60, 0.3);
    values.push(carry);
  }
  assert.ok(Math.max(...values) - Math.min(...values) < 0.2,
    'high-frequency position noise must not switch between carry poses');

  for (let frame = 0; frame < 180; frame += 1) {
    speed = smoothReplayValue(speed, 4, 1 / 60, 0.15);
    carry = smoothReplayValue(carry, 1, 1 / 60, 0.3);
  }
  assert.ok(speed > 3.9);
  assert.ok(carry > 0.99);
  assert.equal(smoothReplayValue(carry, 0, 1, 0.3), 0, 'a seek should not retain stale carry state');
  assert.equal(smoothReplayValue(carry, 0, -1, 0.3), 0, 'a backward seek should reset carry state too');
  assert.ok(smoothReplayValue(carry, 0, -1 / 60, 0.3) < carry,
    'small reverse steps should still ease toward their sampled pose');
});

test('the free-arm stride follows a continuous arc rather than a foot-lift corner', () => {
  let largestStep = 0;
  let previous = freeArmStrideSwing(0, 1, 1);
  for (let index = 1; index <= 100; index += 1) {
    const current = freeArmStrideSwing(index / 100, 1, 1);
    largestStep = Math.max(largestStep, Math.abs(current - previous));
    previous = current;
  }
  assert.ok(largestStep < 0.07, `free-arm arc stepped by ${largestStep.toFixed(3)}`);
  assert.equal(freeArmStrideSwing(0, -1, 1), -freeArmStrideSwing(0, 1, 1));
});

test('score flags suppress changeover labels on ordinary cuts', () => {
  const events = [
    { frame: 0, kind: 'shot', shotType: 'serve', player: 1 },
    { frame: 100, kind: 'point-end', changeover: false },
    { frame: 160, kind: 'shot', shotType: 'serve', player: 1 },
    { frame: 200, kind: 'shot', shotType: 'rally', player: 2 },
    { frame: 260, kind: 'point-end', changeover: true },
    { frame: 330, kind: 'shot', shotType: 'serve', player: 2 },
  ];
  assert.equal(isChangeoverCut(events, 120), false);
  assert.equal(isChangeoverCut(events, 270), true);
  assert.equal(isChangeoverCut(events, 250), true, 'a cut can precede the point-end frame');
});

test('live feeds without score flags fall back to a server change', () => {
  const sameServer = [
    { frame: 0, kind: 'shot', shotType: 'serve', player: 1 },
    { frame: 50, kind: 'point-end' },
    { frame: 80, kind: 'shot', shotType: 'serve', player: 1 },
  ];
  const changedServer = [
    ...sameServer,
    { frame: 100, kind: 'point-end' },
    { frame: 130, kind: 'shot', shotType: 'serve', player: 2 },
  ];
  assert.equal(isChangeoverCut(sameServer, 60), false);
  assert.equal(isChangeoverCut(changedServer, 110), true);
});

test('next-shot lookup selects only a future shot by the requested player', () => {
  const events = [
    { frame: 10, kind: 'shot', player: 1, shotType: 'serve' },
    { frame: 20, kind: 'point-end' },
    { frame: 30, kind: 'shot', player: 2, shotType: 'rally' },
    { frame: 40, kind: 'shot', player: 1, shotType: 'rally' },
  ];
  assert.equal(nextShotEvent(events, 1, 20)?.frame, 40);
  assert.equal(nextShotEvent(events, 2, 30), undefined);
});

test('latest-shot lookup keeps the return stance eased through recovery', () => {
  const events = [
    { frame: 10, kind: 'shot', player: 1 },
    { frame: 20, kind: 'shot', player: 2 },
    { frame: 35, kind: 'point-end' },
  ];
  assert.equal(lastShotFrame(events, 1, 34), 10);
  assert.equal(lastShotFrame(events, 2, 19), undefined);
  assert.equal(lastShotFrame(events, 2, 20), 20);
});
