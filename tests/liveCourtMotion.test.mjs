import assert from 'node:assert/strict';
import test from 'node:test';
import {
  advanceLiveCourtPlayhead,
  deriveLiveCourtFootworkEvents,
  findLiveCourtShotInRange,
  findPlayerShotEvent,
  interpolateLiveCourtFrame,
  liveCourtFacingAngle,
  liveCourtEventsBetween,
  latestLiveCourtShotEvent,
  latestLiveCourtMotionEvent,
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
  assert.deepEqual(footsteps, [{ frame: 6, kind: 'footstep' }]);

  const slides = deriveLiveCourtFootworkEvents([
    playerSample(0),
    playerSample(6, 0, 30),
  ], 60);
  assert.deepEqual(slides, [{ frame: 6, kind: 'slide' }]);

  assert.deepEqual(deriveLiveCourtFootworkEvents([
    playerSample(0),
    playerSample(120, 300, 0),
  ], 60), []);
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
  assert.equal(findLiveCourtShotInRange(events, 111, 121)?.frame, 120);
  assert.equal(latestLiveCourtShotEvent(events, 115)?.frame, 100);
  assert.deepEqual(
    liveCourtEventsBetween(events, 100, 120).map((event) => event.frame),
    [110, 120],
  );
});
