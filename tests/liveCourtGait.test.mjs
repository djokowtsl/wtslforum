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
    // world position of each foot along the travel line (stance offsets cancel out)
    const world = feet.map(foot => ({ along: body + foot.x * direction[0] + foot.z * direction[1], lift: foot.lift }));
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

for (const [name, direction] of [['forwards', [0, 1]], ['backwards', [0, -1]], ['sideways', [1, 0]], ['diagonal', [Math.SQRT1_2, Math.SQRT1_2]]]) {
  test(`planted feet do not slide while running ${name}`, () => {
    for (const speed of [1, 2.5, 4.5]) {
      const { worstSlip, planted, state } = run(direction, speed);
      assert.ok(state.amount > 0.95, 'gait engages when running');
      assert.ok(planted > 50, 'feet spend time planted');
      assert.ok(worstSlip < 0.002 * speed, `${name} @${speed} m/s: planted foot slid ${worstSlip.toFixed(4)} m in a frame`);
    }
  });
}

test('sideways steps shuffle instead of crossing the feet', () => {
  const { minSeparation } = run([1, 0], 4.5);
  // stance feet sit 0.30 m apart; each reaches at most MAX_LATERAL_REACH sideways
  assert.ok(minSeparation > -1e-9, `feet crossed: separation ${minSeparation.toFixed(3)} m`);
  assert.ok(minSeparation < 0.15, 'a fast shuffle should still bring the feet together');
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

test('between points a player walks to a nearby position and is cut to a distant one', async () => {
  const { planReposition, isBetweenPoints, WALK_SPEED } = await import('../lib/liveCourtGait.ts');
  assert.equal(planReposition({ distance: 0.3, betweenPoints: true, secondsToNextServe: 10 }), 'follow');
  assert.equal(planReposition({ distance: 3, betweenPoints: true, secondsToNextServe: 10 }), 'walk');
  // not enough time to walk 3 m before the next serve
  assert.equal(planReposition({ distance: 3, betweenPoints: true, secondsToNextServe: 3 / WALK_SPEED }), 'cut');
  assert.equal(planReposition({ distance: 9, betweenPoints: true, secondsToNextServe: 30 }), 'cut');
  // during a rally, ordinary sample-to-sample movement is followed; a jump is cut
  assert.equal(planReposition({ distance: 1.2, betweenPoints: false, secondsToNextServe: 30 }), 'follow');
  assert.equal(planReposition({ distance: 5, betweenPoints: false, secondsToNextServe: 30 }), 'cut');
  const events = [{ frame: 10, kind: 'shot' }, { frame: 50, kind: 'point-end' }, { frame: 90, kind: 'shot' }];
  assert.equal(isBetweenPoints(events, 40), false);
  assert.equal(isBetweenPoints(events, 50), true);
  assert.equal(isBetweenPoints(events, 89), true);
  assert.equal(isBetweenPoints(events, 90), false);
});

test('a walk continues all the way to the spot instead of snapping the last stretch', async () => {
  const { planReposition } = await import('../lib/liveCourtGait.ts');
  assert.equal(planReposition({ distance: 0.4, betweenPoints: true, secondsToNextServe: 5, walking: true }), 'walk');
  assert.equal(planReposition({ distance: 0.01, betweenPoints: true, secondsToNextServe: 5, walking: true }), 'follow');
});

test('a side switch is only labelled a change of ends when the game (server) changes', async () => {
  const { isGameChange } = await import('../lib/liveCourtGait.ts');
  const events = [
    { frame: 0, kind: 'shot', shotType: 'serve', player: 1 },
    { frame: 100, kind: 'point-end' },
    { frame: 200, kind: 'shot', shotType: 'serve', player: 1 },
    { frame: 300, kind: 'point-end' },
    { frame: 400, kind: 'shot', shotType: 'serve', player: 2 },
  ];
  assert.equal(isGameChange(events, 150), false, 'same server: within a game');
  assert.equal(isGameChange(events, 350), true, 'server changes: a game ended');
  assert.equal(isGameChange(events, 450), false, 'no later serve known');
});

test('last shot lookup finds the player\'s own previous shot however far back', async () => {
  const { lastShotFrame } = await import('../lib/liveCourtGait.ts');
  const events = [{ frame: 10, kind: 'shot', player: 1 }, { frame: 70, kind: 'shot', player: 2 }, { frame: 90, kind: 'point-end' }];
  assert.equal(lastShotFrame(events, 1, 200), 10);
  assert.equal(lastShotFrame(events, 2, 69), undefined);
  assert.equal(lastShotFrame(events, 2, 70), 70);
});

test('changeovers come from the score: odd games, odd sets, every six tie-break points', async () => {
  const { changeoversAfterPoints } = await import('../lib/te4DmoReplaySnapshot.ts');
  // Build a set point by point: games alternate servers; a game is 4 points.
  const points = [];
  let server = 1;
  const addGame = (set, length = 4) => {
    for (let k = 0; k < length; k++) points.push({ s: server, set, tb: 0, g: '0-0' });
    server = server === 1 ? 2 : 1;
  };
  for (let game = 0; game < 10; game++) addGame(1); // set 1: 6-4 (10 games)
  for (let game = 0; game < 9; game++) addGame(2); // set 2: 6-3 (9 games)
  addGame(3);
  const flags = changeoversAfterPoints(points);
  const lastOfGame = (n) => n * 4 - 1; // index of the last point of game n (1-based, across the match)
  // Within a game, never.
  assert.equal(flags[0], false); assert.equal(flags[1], false); assert.equal(flags[2], false);
  // After games 1, 3, 5 of set 1; not after 2 or 4.
  assert.equal(flags[lastOfGame(1)], true);
  assert.equal(flags[lastOfGame(2)], false);
  assert.equal(flags[lastOfGame(3)], true);
  assert.equal(flags[lastOfGame(4)], false);
  // Set 1 ends 6-4 (even): no change; set 2's first game (odd): change.
  assert.equal(flags[lastOfGame(10)], false);
  assert.equal(flags[lastOfGame(11)], true);
  // Set 2 ends 6-3 (odd): change at the set break.
  assert.equal(flags[lastOfGame(19)], true);
  // Number of changeovers in a 6-4 set: after games 1,3,5,7,9.
  const setOne = flags.slice(0, 40).filter(Boolean).length;
  assert.equal(setOne, 5);
});

test('tie-break changeovers fall every six points and a 7-6 set changes ends', async () => {
  const { changeoversAfterPoints } = await import('../lib/te4DmoReplaySnapshot.ts');
  const points = [];
  let server = 1;
  for (let game = 0; game < 12; game++) {
    for (let k = 0; k < 4; k++) points.push({ s: server, set: 1, tb: 0 });
    server = server === 1 ? 2 : 1;
  }
  // Tie-break: 13 points, server changes after the first and then every two.
  for (let k = 0; k < 13; k++) points.push({ s: k === 0 || Math.floor((k - 1) / 2) % 2 === 1 ? 1 : 2, set: 1, tb: 1 });
  points.push({ s: 2, set: 2, tb: 0 });
  const flags = changeoversAfterPoints(points);
  const tieBreakStart = 48;
  assert.equal(flags[tieBreakStart - 1], false, '6-6: no change before the tie-break');
  const inTieBreak = flags.slice(tieBreakStart, tieBreakStart + 12).map((f, k) => (f ? k + 1 : 0)).filter(Boolean);
  assert.deepEqual(inTieBreak, [6, 12], 'after 6 and 12 tie-break points, not at server changes');
  assert.equal(flags[tieBreakStart + 12], true, '7-6 set (13 games) ends with a change');
});

test('a replay that starts mid-set counts from its first game score', async () => {
  const { changeoversAfterPoints } = await import('../lib/te4DmoReplaySnapshot.ts');
  const points = [
    { s: 1, set: 1, tb: 0, g: '2-2' }, { s: 1, set: 1, tb: 0, g: '2-2' },
    { s: 2, set: 1, tb: 0, g: '3-2' }, { s: 2, set: 1, tb: 0, g: '3-2' },
    { s: 1, set: 1, tb: 0, g: '3-3' },
  ];
  assert.deepEqual(changeoversAfterPoints(points), [false, true, false, false, false]);
});

test('a cut is labelled only when its point-end says the players change ends', async () => {
  const { isChangeoverCut } = await import('../lib/liveCourtGait.ts');
  const events = [
    { frame: 0, kind: 'shot', shotType: 'serve', player: 1 },
    { frame: 100, kind: 'point-end', changeover: false },
    { frame: 160, kind: 'shot', shotType: 'serve', player: 1 },
    { frame: 200, kind: 'shot', shotType: 'rally', player: 2 },
    { frame: 260, kind: 'point-end', changeover: true },
    { frame: 330, kind: 'shot', shotType: 'serve', player: 2 },
  ];
  assert.equal(isChangeoverCut(events, 120), false, 'same server, mid-game side switch: plain fade');
  assert.equal(isChangeoverCut(events, 270), true, 'after a game that changes ends');
  assert.equal(isChangeoverCut(events, 250), true, 'cut just before its point-end');
  // Without score flags it falls back to "the server changes".
  const bare = events.map(({ changeover, ...rest }) => rest);
  assert.equal(isChangeoverCut(bare, 120), false);
  assert.equal(isChangeoverCut(bare, 270), true);
});

test('next shot lookup returns the player\'s own next shot', async () => {
  const { nextShotEvent } = await import('../lib/liveCourtGait.ts');
  const events = [{ frame: 10, kind: 'shot', player: 1 }, { frame: 70, kind: 'shot', player: 2 }, { frame: 90, kind: 'point-end' }, { frame: 130, kind: 'shot', player: 1 }];
  assert.equal(nextShotEvent(events, 1, 10)?.frame, 130);
  assert.equal(nextShotEvent(events, 2, 0)?.frame, 70);
  assert.equal(nextShotEvent(events, 2, 70), undefined);
});

test('a walk between points finishes at least a second before the serve', async () => {
  const { planReposition, WALK_SPEED, ARRIVAL_MARGIN } = await import('../lib/liveCourtGait.ts');
  assert.ok(ARRIVAL_MARGIN >= 1);
  const distance = 3;
  const walkTime = distance / WALK_SPEED;
  assert.equal(planReposition({ distance, betweenPoints: true, secondsToNextServe: walkTime + 1.2 }), 'walk');
  assert.equal(planReposition({ distance, betweenPoints: true, secondsToNextServe: walkTime + 0.6 }), 'cut',
    'arriving with under a second to spare would mean settling into the stance mid-walk');
});

test('a side shuffle keeps a natural cadence and the feet apart', () => {
  for (const speed of [1.5, 3, 4.5]) for (const sign of [1, -1]) {
    const { minSeparation, state } = run([sign, 0], speed, 600);
    assert.ok(minSeparation > 0.075, `@${speed} m/s: feet ${minSeparation.toFixed(3)} m apart`);
    const start = state.phase;
    const step = speed / 60;
    let cycles = 0;
    let last = start;
    for (let f = 0; f < 120; f++) {
      advanceGait(state, [sign * step, 0], speed);
      if (state.phase < last) cycles++;
      last = state.phase;
    }
    assert.ok(cycles / 2 <= (speed <= 3 ? 3.2 : 4.5), `@${speed} m/s: ${cycles / 2} step cycles per second`);
  }
});

test('changing direction sideways never brings the feet together or crosses them', () => {
  const state = newGaitState();
  let minSeparation = Infinity;
  for (let f = 0; f < 900; f++) {
    const speed = 2.5;
    const sign = Math.floor(f / 45) % 2 === 0 ? 1 : -1;
    advanceGait(state, [sign * speed / 60, 0], speed);
    const feet = gaitFeet(state, speed);
    if (f > 30) minSeparation = Math.min(minSeparation, 0.30 + feet[1].x - feet[0].x);
  }
  assert.ok(minSeparation > 0.075, `feet ${minSeparation.toFixed(3)} m apart`);
});

test('position filter smooths sample jitter but keeps up with a sprint', async () => {
  const { filterCourtPosition } = await import('../lib/liveCourtGait.ts');
  let state;
  let seed = 3;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  let maxMove = 0;
  let previous;
  for (let f = 0; f < 240; f++) {
    state = filterCourtPosition(state, rand() * 0.02, rand() * 0.02, 1 / 60);
    if (previous && f > 30) maxMove = Math.max(maxMove, Math.hypot(state.x - previous.x, state.z - previous.z));
    previous = state;
  }
  assert.ok(maxMove < 0.005, `still: moved ${maxMove.toFixed(4)} m in a frame`);
  state = undefined;
  for (let f = 0; f < 120; f++) state = filterCourtPosition(state, (f / 60) * 5, 0, 1 / 60);
  assert.ok(119 / 60 * 5 - state.x < 0.1, `lag ${(119 / 60 * 5 - state.x).toFixed(3)} m`);
  assert.ok(Math.abs(state.vx - 5) < 0.2);
});

test('reversing direction does not move the feet', () => {
  for (const [a, b] of [[[1, 0], [-1, 0]], [[0, 1], [0, -1]]]) {
    const state = newGaitState();
    for (let f = 0; f < 90; f++) advanceGait(state, [a[0] * 2.5 / 60, a[1] * 2.5 / 60], 2.5);
    const before = gaitFeet(state, 2.5);
    advanceGait(state, [b[0] * 1e-4, b[1] * 1e-4], 2.5);
    const after = gaitFeet(state, 2.5);
    for (let k = 0; k < 2; k++) {
      const moved = Math.hypot(after[k].x - before[k].x, after[k].z - before[k].z);
      assert.ok(moved < 0.01, `foot ${k} jumped ${moved.toFixed(3)} m on reversal`);
    }
  }
});

test('speeding up does not drag the planted foot', () => {
  const state = newGaitState();
  let body = 0;
  let worst = 0;
  let total = 0;
  let previous = null;
  for (let f = 0; f < 120; f++) {
    const speed = Math.min(4, 0.5 + f * 0.06);
    body += speed / 60;
    advanceGait(state, [0, speed / 60], speed);
    const feet = gaitFeet(state, speed);
    const world = feet.map(foot => ({ z: body + foot.z, lift: foot.lift }));
    if (previous && f > 20) for (let k = 0; k < 2; k++) {
      if (world[k].lift === 0 && previous[k].lift === 0) {
        const slid = Math.abs(world[k].z - previous[k].z);
        worst = Math.max(worst, slid);
        total += slid;
      }
    }
    previous = world;
  }
  assert.ok(total < 0.04, `planted feet slid ${total.toFixed(3)} m in all while accelerating`);
  assert.ok(worst < 0.015, `planted foot slid ${worst.toFixed(4)} m in a frame while accelerating`);
});

test('walking and jogging use a natural step cadence', () => {
  for (const [speed, low, high] of [[1.4, 1.7, 2.4], [3, 2.6, 3.6]]) {
    const state = newGaitState();
    let wraps = 0, last = 0;
    for (let frame = 0; frame < 600; frame++) {
      advanceGait(state, [0, speed / 60], speed);
      if (frame > 120 && state.phase < last - 0.5) wraps++;
      last = state.phase;
    }
    const stepsPerSecond = 2 * wraps / (480 / 60);
    assert.ok(stepsPerSecond >= low && stepsPerSecond <= high,
      `@${speed} m/s: ${stepsPerSecond} steps/s`);
  }
});

test('erratic speed and direction keep both feet finite and separated in the gait', () => {
  const state = newGaitState();
  let seed = 9;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  let speed = 2, angle = 0;
  for (let frame = 0; frame < 3000; frame++) {
    speed = Math.max(0, Math.min(6, speed + (rand() - 0.5) * 0.8));
    if (rand() < 0.03) angle += Math.PI * (rand() < 0.5 ? 1 : 0.5);
    advanceGait(state, [Math.sin(angle) * speed / 60, Math.cos(angle) * speed / 60], speed);
    const feet = gaitFeet(state, speed);
    for (const foot of feet) {
      assert.ok(Number.isFinite(foot.x) && Number.isFinite(foot.z) && Number.isFinite(foot.lift),
        `frame ${frame}: ${JSON.stringify(foot)}`);
    }
    assert.ok(state.offset === undefined || (state.offset >= 0.25 && state.offset <= 0.75));
  }
});
