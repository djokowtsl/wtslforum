import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { isCapturedVolleyShot } from '../lib/dmoVolley.ts';
import {
  volleyCaptureWeight, recordedBackhandFaceRoll, recordedStrokeForSide,
  recordedStrokeUsesTwoHands, VOLLEY_LEAD_FRAMES, VOLLEY_RECOVERY_FRAMES,
} from '../components/DmoCapturedGroundstroke.ts';

function flight() {
  const event = { frame: 60, kind: 'shot', shotType: 'rally', player: 1 };
  const events = [{ frame: 0, kind: 'shot', shotType: 'rally', player: 2 }, event];
  const samples = Array.from({ length: 13 }, (_, i) => ({
    frame: i * 5,
    values: [-900 + i * 100, 70, 150 - i * 3, 300, 0, -900, 0],
  }));
  return { event, events, samples, contact: samples.at(-1).values };
}

const qualifies = ({ event, events, samples, contact }, sounds = [], fps = 60) =>
  isCapturedVolleyShot(event, contact, samples, events, sounds, fps);

test('unbounced net approaches and serve-and-volley returns qualify on either end', () => {
  const data = flight();
  assert.equal(qualifies(data), true);
  assert.equal(qualifies({
    ...data,
    events: [{ frame: -80, kind: 'shot', shotType: 'serve', player: 1 }, ...data.events],
  }), true);
  const reflected = data.samples.map(sample => ({
    ...sample, values: sample.values.map((v, axis) => [0, 3, 5].includes(axis) ? -v : v),
  }));
  assert.equal(qualifies({ ...data, samples: reflected, contact: reflected.at(-1).values }), true);
  assert.equal(qualifies({
    ...data, event: { ...data.event, frame: 120 },
    events: data.events.map(e => ({ ...e, frame: e.frame * 2 })),
    samples: data.samples.map(s => ({ ...s, frame: s.frame * 2 })),
  }, [], 120), true);
  assert.equal(qualifies(data, [{ frame: 70, kind: 'bounce' }]), true,
    'a later outgoing bounce cannot relabel this contact');
});

test('being near the net never turns a bounced groundstroke into a volley', () => {
  const data = flight();
  assert.equal(qualifies(data, [{ frame: 30, kind: 'bounce' }]), false);
  assert.equal(qualifies({
    ...data, samples: data.samples.map(s => s.frame === 30 ? { ...s, values: s.values.map(
      (v, axis) => axis === 2 ? 5 : v,
    ) } : s),
  }), false);
  // All sampled heights stay above the ground, but the direction reversal
  // reveals a bounce between them.
  const heights = [150, 135, 115, 90, 60, 30, 28, 60, 90, 105, 115, 120, 125];
  const hiddenBounce = data.samples.map((s, i) => ({
    ...s, values: s.values.map((v, axis) => axis === 2 ? heights[i] : v),
  }));
  assert.equal(qualifies({ ...data, samples: hiddenBounce, contact: hiddenBounce.at(-1).values }), false);
});

test('serves, overheads, baseline hits and unreachable contacts retain their existing strokes', () => {
  const data = flight();
  assert.equal(qualifies({ ...data, event: { ...data.event, shotType: 'serve' } }), false);
  assert.equal(qualifies({ ...data, events: [{ ...data.events[0], shotType: 'serve' }, data.event] }), false);
  for (const [axis, value] of [[2, 250], [2, 10], [3, 1000], [0, -100], [1, 300]]) {
    const contact = [...data.contact];
    contact[axis] = value;
    assert.equal(qualifies({ ...data, contact }), false, `reject contact axis ${axis}=${value}`);
  }
  assert.equal(recordedStrokeForSide('backhand', false), 'backhand');
  assert.equal(recordedStrokeForSide('forehand', false), 'forehand');
});

test('incomplete flights and point boundaries fail closed rather than inventing a volley', () => {
  const data = flight();
  assert.equal(qualifies({ ...data, contact: undefined }), false);
  assert.equal(qualifies({ ...data, event: undefined }), false);
  assert.equal(qualifies({ ...data, events: [data.event] }), false);
  assert.equal(qualifies({
    ...data, events: [data.events[0], { frame: 25, kind: 'point-end' }, data.event],
  }), false);
  assert.equal(qualifies({ ...data, events: [{ ...data.events[0], player: 1 }, data.event] }), false);
  assert.equal(qualifies({ ...data, samples: data.samples.filter((_, i) => i % 3 === 0) }), false);
  assert.equal(qualifies({ ...data, samples: data.samples.slice(3) }), false);
  assert.equal(qualifies({ ...data, samples: data.samples.slice(0, -3) }), false);
  assert.equal(qualifies({ ...data, samples: data.samples.map((s, i) => i === 5
    ? { ...s, values: s.values.map((v, axis) => axis === 2 ? NaN : v) } : s) }), false);
  const belowNet = data.samples.map(s => ({
    ...s, values: s.values.map((v, axis) => axis === 2 ? 60 : v),
  }));
  assert.equal(qualifies({ ...data, samples: belowNet, contact: belowNet.at(-1).values }), false);
});

test('volley timing and grip are short, mirrored, one-handed, and isolated from ground backhands', () => {
  assert.equal(VOLLEY_LEAD_FRAMES, 26);
  assert.equal(VOLLEY_RECOVERY_FRAMES, 44);
  for (const frame of [-100, -26, 44, 100, NaN]) assert.equal(volleyCaptureWeight(frame), 0);
  assert.equal(volleyCaptureWeight(0), 1);
  assert.ok(volleyCaptureWeight(-18) > 0 && volleyCaptureWeight(-18) < 1);
  assert.ok(volleyCaptureWeight(35) > 0 && volleyCaptureWeight(35) < 1);
  for (const oneHanded of [true, false]) {
    assert.equal(recordedBackhandFaceRoll('volley-backhand', oneHanded), 35 * Math.PI / 180);
  }
  assert.equal(recordedBackhandFaceRoll('backhand', true), 72 * Math.PI / 180);
  assert.equal(recordedBackhandFaceRoll('backhand', false), 0);
  for (const side of ['forehand', 'backhand']) {
    const stroke = recordedStrokeForSide(side, true);
    assert.equal(recordedStrokeUsesTwoHands(stroke, { forehand: 'two', backhand: 'two' }, true), false);
  }
});

test('production selection keeps smash priority and only uses the volley gate at a new contact', () => {
  const court = readFileSync(new URL('../components/DmoLiveCourt3D.tsx', import.meta.url), 'utf8');
  assert.match(court, /else if \(isCapturedVolleyShot\(/);
  assert.match(court, /strokeEvent, contactSample, samples, events, soundEventsRef\.current/);
  assert.match(court, /capturedEvent\.stroke = recordedStrokeForSide\(baseStroke, true\)/);
  assert.match(court, /volley \? volleyCaptureWeight\(captureDelta\)/);
  assert.doesNotMatch(court, /recordedStrokeForSide\(baseStroke, strokeCue === 'close-net'\)/);
  const selectionStart = court.indexOf('const recordedVolley =');
  const selectionEnd = court.indexOf('rig.root.userData.capturedGroundstrokeEvent = capturedEvent;', selectionStart);
  assert.ok(selectionStart >= 0 && selectionEnd > selectionStart);
  assert.doesNotMatch(court.slice(selectionStart, selectionEnd), /lowReachDrop|lowReachFull/);
  const native = readFileSync(new URL('../components/DmoNativePlayer.ts', import.meta.url), 'utf8');
  assert.match(native, /recordedBackhandFaceRoll\(playback\?\.stroke, oneHandedStroke, playback\?\.slice\)/);
  assert.match(native, /dominant === 'r' \? 1 : -1/);
});
