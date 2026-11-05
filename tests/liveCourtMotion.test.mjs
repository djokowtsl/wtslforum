import assert from 'node:assert/strict';
import test from 'node:test';
import {
  advanceLiveCourtPlayerPosition,
  advanceLiveCourtPlayhead,
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
  mergeLiveCourtEvents,
  mergeLiveCourtSamples,
} from '../lib/liveCourtMotion.ts';

function sample(frame, ballX) {
  return { frame, values: [ballX, 0, 0, 1, 2, 3, 4] };
}

function playerSample(frame, playerOneX = 0, playerOneZ = 0, playerTwoX = 0, playerTwoZ = 0) {
  return { frame, values: [0, 0, 0, playerOneX, playerOneZ, playerTwoX, playerTwoZ] };
}

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

test('visual sliding is attributed to one player and eases out after the lateral burst', () => {
  const events = [{ frame: 100, kind: 'slide', player: 2 }];
  assert.equal(liveCourtSlideWeight(events, 1, 100), 0);
  assert.equal(liveCourtSlideWeight(events, 2, 100), 1);
  assert.ok(liveCourtSlideWeight(events, 2, 112) < 1);
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
