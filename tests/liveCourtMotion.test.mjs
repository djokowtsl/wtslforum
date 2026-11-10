import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  advanceLiveCourtPlayerPosition,
  advanceLiveCourtPlayhead,
  clampLiveCourtPlayheadToTail,
  deriveLiveCourtFootworkEvents,
  findLiveCourtShotInRange,
  findPlayerShotEvent,
  inferLiveCourtContactCue,
  interpolateLiveCourtFrame,
  isLiveCourtBetweenPoints,
  liveCourtFacingAngle,
  liveCourtEventsBetween,
  latestLiveCourtShotEvent,
  latestLiveCourtMotionEvent,
  liveCourtSlideWeight,
  liveCourtReplayFrameScale,
  nextLiveCourtCarryMode,
  LOW_REACH_MAX_DROP,
  lowReachDrop,
  lungeWeight,
  LUNGE_DROP,
  BALL_PASSED_MARGIN_CM,
  ballPassedReceiverFrame,
  liveCourtShotSpin,
  liveCourtBallHeldSeconds,
  serveBounceHeight,
  mergeLiveCourtEvents,
  mergeLiveCourtSamples,
} from '../lib/liveCourtMotion.ts';
import { LIVE_DMO_EVENT_SYNC_BUFFER_FRAMES } from '../lib/te4DmoLive.ts';

function sample(frame, ballX) {
  return { frame, values: [ballX, 0, 0, 1, 2, 3, 4] };
}

function playerSample(frame, playerOneX = 0, playerOneZ = 0, playerTwoX = 0, playerTwoZ = 0) {
  return { frame, values: [0, 0, 0, playerOneX, playerOneZ, playerTwoX, playerTwoZ] };
}

test('rally carry starts at 2.2 m/s and releases below 2.0 m/s', () => {
  const mode = (previous, speed, overrides = {}) => nextLiveCourtCarryMode(previous, {
    walking: false,
    shotDue: false,
    strolling: 0,
    speed,
    ...overrides,
  });
  assert.equal(mode(false, 2.19), false);
  assert.equal(mode(false, 2.2), true);
  assert.equal(mode(true, 2.1), true, 'hysteresis keeps the racket at the side');
  assert.equal(mode(true, 1.99), false);
  assert.equal(mode(false, 4, { shotDue: true }), false, 'the take-back gets the racket back in front');
  assert.equal(mode(false, 1, { walking: true }), true);
  assert.equal(mode(false, 1, { strolling: 0.8 }), true);
  assert.equal(mode(false, 0, { strolling: 0.5 }), false);
  assert.equal(mode(true, 0, { strolling: 0.5 }), true, 'the strolling deadband retains the prior carry');
});

test('carry intent switches between recovery, split-step, and shot-ready poses', () => {
  const state = { walking: false, shotDue: false, strolling: 0, speed: 0 };
  assert.equal(nextLiveCourtCarryMode(false, { ...state, carryIntent: 0.8 }), true);
  assert.equal(nextLiveCourtCarryMode(true, { ...state, carryIntent: 0.2 }), false);
  assert.equal(nextLiveCourtCarryMode(true, { ...state, carryIntent: 0.5 }), true);
  assert.equal(nextLiveCourtCarryMode(false, { ...state, carryIntent: 0.5 }), false);
  assert.equal(nextLiveCourtCarryMode(true, { ...state, shotDue: true, carryIntent: 1 }), false);
  assert.equal(nextLiveCourtCarryMode(false, { ...state, walking: true, carryIntent: 0 }), true);
});

test('overlapping court updates merge into one ordered, bounded timeline', () => {
  const merged = mergeLiveCourtSamples(
    [sample(0, 0), sample(1, 1), sample(2, 2)],
    [sample(1, 100), sample(2, 200), sample(3, 3), sample(4, 4)],
    2,
  );

  assert.deepEqual(merged.map((item) => item.frame), [2, 3, 4]);
  assert.equal(merged[0].values[0], 2);
});

test('the playhead advances monotonically and stops at the newest frame instead of wrapping', () => {
  const samples = [sample(10, 0), sample(13, 3)];

  assert.equal(advanceLiveCourtPlayhead(null, 50, 1, samples), 13);
  assert.equal(advanceLiveCourtPlayhead(10, 50, 1, samples), 13);
  assert.equal(advanceLiveCourtPlayhead(13, 50, 1, samples), 13);
});

test('live playback keeps one DMO update interval ahead for event alignment', () => {
  const samples = Array.from({ length: 120 }, (_, frame) => sample(frame, frame));
  assert.equal(LIVE_DMO_EVENT_SYNC_BUFFER_FRAMES, 72);
  assert.equal(clampLiveCourtPlayheadToTail(119, samples, LIVE_DMO_EVENT_SYNC_BUFFER_FRAMES), 47);
  assert.equal(
    advanceLiveCourtPlayhead(46, 80, 1, samples, 60, LIVE_DMO_EVENT_SYNC_BUFFER_FRAMES),
    47,
  );
  assert.equal(
    advanceLiveCourtPlayhead(100, 80, 1, samples, 60, LIVE_DMO_EVENT_SYNC_BUFFER_FRAMES),
    47,
    'playback cannot outrun the available DMO event window',
  );
});

test('low rendering FPS does not turn the playback clock into slow motion', () => {
  const samples = [sample(0, 0), sample(36000, 0)];
  for (const renderingFps of [5, 10, 15, 30, 60]) {
    let frame = 0;
    for (let tick = 0; tick < renderingFps * 10; tick++) {
      frame = advanceLiveCourtPlayhead(frame, 1000 / renderingFps, 1, samples, 60);
    }
    assert.ok(Math.abs(frame - 600) < 1e-7, `${renderingFps} rendered FPS still advances ten match seconds`);
  }
  assert.equal(advanceLiveCourtPlayhead(0, 200, 2, samples, 60), 24, 'selected playback speed is preserved');
  assert.equal(advanceLiveCourtPlayhead(0, 20000, 1, samples, 60), 60, 'a suspended-tab gap is bounded to one second');
  assert.equal(advanceLiveCourtPlayhead(0, NaN, 1, samples, 60), 0);
});

test('render loops pass wall-clock elapsed time rather than the animation safety timestep', async () => {
  const threeD = await readFile(new URL('../components/DmoLiveCourt3D.tsx', import.meta.url), 'utf8');
  assert.match(threeD, /const elapsed = Math\.min\(80, clockElapsed\)/, 'pose/physics retains its safety bound');
  assert.equal(
    [...threeD.matchAll(/advanceLiveCourtPlayhead\(\s*\w+Ref\.current,\s*clockElapsed,/g)].length,
    2,
    'both live and stored replay clocks receive untruncated frame time',
  );
  const twoD = await readFile(new URL('../components/DmoLiveCourt.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(twoD, /const elapsed = Math\.min\(80/);
});

test('sample interpolation and rally boundaries track the absolute DMO frame', () => {
  const samples = [sample(10, 0), sample(14, 20)];
  const interpolated = interpolateLiveCourtFrame(samples, 12, 5);
  assert.equal(interpolated?.[0], 10);

  const events = mergeLiveCourtEvents([], [
    { frame: 10, kind: 'shot' },
    { frame: 12, kind: 'point-end' },
    { frame: 12, kind: 'shot' },
  ], 10);
  assert.deepEqual(events, [
    { frame: 10, kind: 'shot' },
    { frame: 12, kind: 'shot' },
    { frame: 12, kind: 'point-end' },
  ]);
  assert.equal(latestLiveCourtMotionEvent(events, 11)?.kind, 'shot');
  assert.equal(latestLiveCourtMotionEvent(events, 12)?.kind, 'point-end');
});

test('wide sample gaps ease into the next court state instead of snapping', () => {
  const samples = [sample(10, 0), sample(110, 100)];

  assert.equal(interpolateLiveCourtFrame(samples, 99, 10)?.[0], 0);
  assert.equal(interpolateLiveCourtFrame(samples, 100, 10)?.[0], 0);
  assert.equal(interpolateLiveCourtFrame(samples, 105, 10)?.[0], 50);
  assert.equal(interpolateLiveCourtFrame(samples, 110, 10)?.[0], 100);
});

test('right-handed player models face the net from either end of the DMO court', () => {
  const negativeEndFacing = liveCourtFacingAngle(-12);
  const positiveEndFacing = liveCourtFacingAngle(12);

  assert.equal(negativeEndFacing, Math.PI / 2);
  assert.equal(positiveEndFacing, -Math.PI / 2);
  assert.ok(-Math.sin(negativeEndFacing) < 0);
  assert.ok(-Math.sin(positiveEndFacing) > 0);
});

test('footwork events distinguish normal steps from lateral slides and ignore teleports', () => {
  const footsteps = deriveLiveCourtFootworkEvents([
    playerSample(0),
    playerSample(6, 20, 0),
  ], 60);
  assert.deepEqual(footsteps, [{ frame: 6, kind: 'footstep', player: 1 }]);

  const slides = deriveLiveCourtFootworkEvents([
    playerSample(0),
    playerSample(6, 0, 30),
  ], 60);
  assert.deepEqual(slides, [{ frame: 6, kind: 'slide', player: 1 }]);
  assert.deepEqual(deriveLiveCourtFootworkEvents([
    playerSample(0),
    playerSample(6, 0, 0, 0, 30),
  ], 60), [{ frame: 6, kind: 'slide', player: 2 }]);

  assert.deepEqual(deriveLiveCourtFootworkEvents([
    playerSample(0),
    playerSample(120, 300, 0),
  ], 60), []);
});

test('visual sliding is attributed to one player, eases in, and eases out after the lateral burst', () => {
  const events = [{ frame: 100, kind: 'slide', player: 2 }];
  assert.equal(liveCourtSlideWeight(events, 1, 106), 0);
  // Eases in (it used to start at full strength, dropping the hips in one frame).
  assert.equal(liveCourtSlideWeight(events, 2, 100), 0);
  let steepest = 0;
  for (let f = 100; f < 126; f++) {
    steepest = Math.max(steepest, Math.abs(liveCourtSlideWeight(events, 2, f + 1) - liveCourtSlideWeight(events, 2, f)));
  }
  assert.ok(steepest < 0.35, `slide weight step per frame ${steepest.toFixed(2)}`);
  assert.ok(liveCourtSlideWeight(events, 2, 106) > 0.6);
  assert.ok(liveCourtSlideWeight(events, 2, 112) < liveCourtSlideWeight(events, 2, 106));
  assert.equal(liveCourtSlideWeight(events, 2, 126), 0);
});

test('motion event lookups stay scoped to the requested frames and player', () => {
  const events = mergeLiveCourtEvents([], [
    { frame: 80, kind: 'shot', player: 1, shotType: 'serve' },
    { frame: 100, kind: 'shot', player: 2, shotType: 'rally' },
    { frame: 110, kind: 'point-end' },
    { frame: 120, kind: 'shot', player: 1, shotType: 'rally' },
  ], 20);

  assert.equal(findPlayerShotEvent(events, 1, 102)?.frame, 80);
  assert.equal(findPlayerShotEvent(events, 2, 102)?.frame, 100);
  assert.equal(findPlayerShotEvent(events, 1, 40, 64, 'serve')?.frame, 80,
    'a serve event must remain discoverable during its preparation window');
  assert.equal(findLiveCourtShotInRange(events, 111, 121)?.frame, 120);
  assert.equal(latestLiveCourtShotEvent(events, 115)?.frame, 100);
  assert.deepEqual(
    liveCourtEventsBetween(events, 100, 120).map((event) => event.frame),
    [110, 120],
  );
});

test('players are in repositioning mode after a point until the next serve', () => {
  const events = [
    { frame: 100, kind: 'point-end' },
    { frame: 180, kind: 'shot', player: 1, shotType: 'serve' },
  ];
  assert.equal(isLiveCourtBetweenPoints(events, 99), false);
  assert.equal(isLiveCourtBetweenPoints(events, 100), true);
  assert.equal(isLiveCourtBetweenPoints(events, 179), true);
  assert.equal(isLiveCourtBetweenPoints(events, 180), false);
  assert.equal(isLiveCourtBetweenPoints([{ frame: 100, kind: 'point-end' }], 200), true);
});

test('player repositioning advances by a bounded physical step', () => {
  const oneMeterStep = advanceLiveCourtPlayerPosition([0, 0], [3, 4], 1);
  assert.ok(Math.abs(oneMeterStep[0] - 0.6) < 1e-12);
  assert.ok(Math.abs(oneMeterStep[1] - 0.8) < 1e-12);
  assert.deepEqual(advanceLiveCourtPlayerPosition([0, 0], [3, 4], 0), [0, 0]);
  assert.deepEqual(advanceLiveCourtPlayerPosition([0, 0], [0.5, 0], 1), [0.5, 0]);
});

test('stroke variation cues use only nearby ball/player samples, never invented shot labels', () => {
  const event = { frame: 20, kind: 'shot', player: 1, shotType: 'rally' };
  const lowContact = { frame: 20, values: [0, 0, 58, 920, 0, -900, 0] };
  const closeNet = { frame: 20, values: [0, 0, 145, 280, 0, -900, 0] };

  assert.equal(inferLiveCourtContactCue(event, [lowContact]), 'low-contact');
  assert.equal(inferLiveCourtContactCue(event, [closeNet]), 'close-net');
  assert.equal(inferLiveCourtContactCue({ ...event, player: 2 }, [closeNet]), 'standard');
  assert.equal(inferLiveCourtContactCue({ ...event, shotType: 'serve' }, [lowContact]), 'standard');
  assert.equal(inferLiveCourtContactCue(event, [{ ...lowContact, frame: 24 }]), 'standard');
  const gentleFlight = [
    { frame: 20, values: [0, 0, 100, 920, 0, -900, 0] },
    { frame: 24, values: [25, 0, 94, 920, 0, -900, 0] },
  ];
  assert.equal(inferLiveCourtContactCue(event, gentleFlight), 'soft-touch');
  assert.equal(inferLiveCourtContactCue(event, gentleFlight, 0), 'soft-touch');
  const firmFlight = [
    gentleFlight[0],
    { frame: 24, values: [300, 0, 110, 920, 0, -900, 0] },
  ];
  assert.equal(inferLiveCourtContactCue(event, firmFlight), 'standard');
  assert.equal(
    inferLiveCourtContactCue(event, [{ ...lowContact, frame: 20, values: [0, 0, 145, 920, 0, -900, 0] }]),
    'standard',
  );
});

test('service-line volleys require an unbounced, non-overhead ball on the player side', () => {
  const fps = 30;
  const flight = (height = 90) => [0, 2, 4, 6, 8, 10, 12].map((frame, index) => ({
    frame,
    values: [400 - index * 160, 0, height, -600, 0, 1200, 0],
  }));
  const event = { frame: 12, player: 1, shotType: 'rally' };

  assert.equal(inferLiveCourtContactCue(event, flight(), fps), 'close-net',
    'a pre-bounce contact around 6 m from the net is a volley');

  const bounced = flight();
  bounced[4].values[2] = 5;
  assert.notEqual(inferLiveCourtContactCue(event, bounced, fps), 'close-net',
    'a ball that bounced on the player side is not a volley');

  assert.notEqual(inferLiveCourtContactCue(event, flight(230), fps), 'close-net',
    'a ball above 2.2 m remains an overhead/standard shot');

  const baseline = flight().map(sample => ({
    frame: sample.frame,
    values: [...sample.values.slice(0, 3), -1200, 0, 1200, 0],
  }));
  assert.notEqual(inferLiveCourtContactCue(event, baseline, fps), 'close-net',
    'baseline shots remain groundstrokes even if a bounce was not sampled');

  const otherSide = flight().map(sample => ({
    frame: sample.frame,
    values: [
      -sample.values[0], sample.values[1], sample.values[2],
      -1200, 0, 600, 0,
    ],
  }));
  assert.equal(inferLiveCourtContactCue({ ...event, player: 2 }, otherSide, fps), 'close-net',
    'the same detection works on the other side of the court');

  const beforeNetCrossing = [
    { frame: 0, values: [400, 0, 100, -600, 0, 1200, 0] },
    { frame: 4, values: [80, 0, 100, -600, 0, 1200, 0] },
    { frame: 8, values: [-80, 0, 100, -600, 0, 1200, 0] },
  ];
  assert.notEqual(
    inferLiveCourtContactCue({ ...event, frame: 7 }, beforeNetCrossing, fps),
    'close-net',
    'a net crossing visible only after the hit is not used for a live volley cue',
  );

  const futureOverhead = [
    { frame: 0, values: [400, 0, 100, -600, 0, 1200, 0] },
    { frame: 4, values: [-80, 0, 90, -600, 0, 1200, 0] },
    { frame: 8, values: [-240, 0, 230, -600, 0, 1200, 0] },
  ];
  assert.equal(
    inferLiveCourtContactCue({ ...event, frame: 7 }, futureOverhead, fps),
    'close-net',
    'a high ball sample after the hit does not turn a volley into an overhead',
  );
});

test('replay stroke timing uses 60 Hz frames while live 60 Hz timing is unchanged', () => {
  assert.equal(liveCourtReplayFrameScale(30), 2);
  assert.equal(liveCourtReplayFrameScale(60), 1);
  assert.equal(liveCourtReplayFrameScale(0), 1);
  const events = [
    { frame: 100, kind: 'shot', player: 1, shotType: 'rally' },
    { frame: 200, kind: 'shot', player: 1, shotType: 'rally' },
  ];
  assert.equal(findPlayerShotEvent(events, 1, 85, 24 / liveCourtReplayFrameScale(30)), undefined,
    '30 Hz replays narrow the event lookup window in source frames');
  assert.equal(findPlayerShotEvent(events, 1, 85, 24 / liveCourtReplayFrameScale(60))?.frame, 100,
    '60 Hz live timing retains the existing event window');
});

test('low and wide contacts use the calibrated conservative crouch', () => {
  assert.equal(lowReachDrop(0.7, 1.2), 0);
  assert.equal(lowReachDrop(0.5, 1.4), 0);
  assert.ok(lowReachDrop(0.4, 1.2) > 0.03 && lowReachDrop(0.4, 1.2) < lowReachDrop(0.3, 1.2));
  assert.ok(Math.abs(lowReachDrop(0.25, 1.2) - 0.15) < 1e-9);
  assert.ok(Math.abs(lowReachDrop(1.0, 2.0) - LUNGE_DROP) < 1e-9);
  assert.equal(lungeWeight(2.0), 1);
  assert.equal(lungeWeight(2.0, true), 0.5, 'a true slice keeps half the wide-ball lunge');
  assert.equal(lungeWeight(2.0, false), 1, 'a topspin drive keeps the full lunge');
  assert.equal(lungeWeight(1.4), 0);
  assert.equal(lungeWeight(3.2), 0);
  assert.equal(lowReachDrop(0.2, 2.0), LOW_REACH_MAX_DROP);
  assert.equal(lowReachDrop(1.0, 4.3), 0);
  assert.equal(lowReachDrop(Number.NaN, 1), 0);
});

test('ballPassedReceiverFrame uses only samples after the shot and through the current frame', () => {
  assert.equal(BALL_PASSED_MARGIN_CM, 100);
  const negativeSide = [0, 10, 20, 30, 40].map((frame, index) => ({
    frame,
    values: [-600 - index * 200, 0, 50, 1200, 0, -1200, 0],
  }));
  assert.equal(ballPassedReceiverFrame(negativeSide, 0, 30, 5), undefined,
    'the ball at -1200 cm is not past the player at -1200 cm');
  assert.equal(ballPassedReceiverFrame(negativeSide, 0, 35, 5), undefined,
    'future samples are not read on a live feed');
  assert.equal(ballPassedReceiverFrame(negativeSide, 0, 40, 5), 40,
    'the ball at -1400 cm is more than 1 m past the player');
  assert.equal(ballPassedReceiverFrame(negativeSide, 40, 35, 5), undefined,
    'invalid time windows fail closed');

  const positiveSide = [0, 10, 20, 30, 40].map((frame, index) => ({
    frame,
    values: [600 + index * 200, 0, 50, 1200, 0, -1200, 0],
  }));
  assert.equal(ballPassedReceiverFrame(positiveSide, 0, 40, 3), 40,
    'the same check works for a receiver on the positive side');
});

test('slices are inferred from ball flight through the first bounce', () => {
  const flightSamples = (dropRate, { hitFrame = 100, vz = 380, h0 = 70, gapAt = -1 } = {}) => {
    const samples = [];
    for (let frame = hitFrame - 10; frame <= hitFrame + 70; frame += 1) {
      if (frame === gapAt) continue;
      const seconds = Math.max(0, (frame - hitFrame) / 30);
      let height = h0 + vz * seconds - 0.5 * dropRate * seconds * seconds;
      if (height < 0) height = -height * 0.5;
      samples.push({
        frame,
        values: [-1100 + 30 * (frame - hitFrame), 0, Math.round(Math.max(0, height)), -1150, 0, 1150, 0],
      });
    }
    return samples;
  };
  assert.equal(liveCourtShotSpin(flightSamples(700, { vz: 300 }), 100, 30), 'slice');
  assert.equal(liveCourtShotSpin(flightSamples(850, { vz: 300 }), 100, 30), 'slice');
  assert.equal(liveCourtShotSpin(flightSamples(1100), 100, 30), 'topspin');
  assert.equal(liveCourtShotSpin(flightSamples(1400, { vz: 450 }), 100, 30), 'topspin');
  assert.equal(liveCourtShotSpin(flightSamples(700).filter(sample => sample.frame <= 110), 100, 30), null);
  assert.equal(liveCourtShotSpin(
    flightSamples(700, { vz: 300 }).filter(sample => sample.frame < 110 || sample.frame > 114),
    100,
    30,
  ), null);
  assert.equal(liveCourtShotSpin([], 100, 30), null);
});

test('the server bounces the ball twice before the toss, only while the recording holds it', () => {
  assert.equal(serveBounceHeight(3, 5), null);
  assert.equal(serveBounceHeight(1.2, 5), null);
  assert.ok(Math.abs(serveBounceHeight(2.55, 5) - 1) < 1e-9);
  assert.ok(serveBounceHeight(2.55 - 0.275, 5) < 1e-9);
  assert.ok(serveBounceHeight(2.0 - 0.275, 5) < 1e-9);
  assert.equal(serveBounceHeight(2.4, 2.2), null);
  assert.ok(serveBounceHeight(1.8, 2.2) !== null);
  const samples = [];
  for (let frame = 0; frame <= 90; frame += 2) {
    samples.push({
      frame,
      values: [frame < 30 ? frame * 10 : 300, 20, frame < 30 ? 100 - frame : 60, 0, 0, 0, 0],
    });
  }
  assert.ok(Math.abs(liveCourtBallHeldSeconds(samples, 90, 30) - 2) < 0.1);
  assert.equal(liveCourtBallHeldSeconds([], 90, 30), 0);
});
