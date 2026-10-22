import assert from 'node:assert/strict';
import test from 'node:test';
import {
  advanceLiveCourtPlayhead,
  interpolateLiveCourtFrame,
  latestLiveCourtMotionEvent,
  mergeLiveCourtEvents,
  mergeLiveCourtSamples,
} from '../lib/liveCourtMotion.ts';

function sample(frame, ballX) {
  return { frame, values: [ballX, 0, 0, 1, 2, 3, 4] };
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
