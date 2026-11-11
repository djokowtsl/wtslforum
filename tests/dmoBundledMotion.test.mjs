import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeBundledMotion, bundledMotionFrame, bundledAnimationEvents } from '../lib/dmoBundledMotion.mjs';

const schema = { format: 'WTM1', rigHash: 'ab'.repeat(32), bones: ['pelvis'], pelvisIndex: 0 };
function recording() {
  const buffer = new ArrayBuffer(52 + 2 * 20);
  const view = new DataView(buffer);
  new Uint8Array(buffer, 0, 4).set([87, 84, 77, 49]);
  view.setUint16(4, 1, true); view.setUint16(6, 0, true);
  view.setUint32(8, 2, true); view.setFloat32(12, 30, true); view.setFloat32(16, 1 / 30, true);
  new Uint8Array(buffer, 20, 32).fill(0xab);
  for (let i = 0; i < 2; i++) {
    view.setFloat32(52 + i * 20, i / 10, true);
    view.setInt16(52 + i * 20 + 18, 32767, true);
  }
  return buffer;
}
test('decodes and normalizes the native local rotations', () => {
  const clip = decodeBundledMotion(recording(), schema);
  assert.equal(clip.frameCount, 2);
  assert.equal(clip.positions[3], Math.fround(.1));
  assert.deepEqual([...clip.rotations], [0, 0, 0, 1, 0, 0, 0, 1]);
});
test('clamps playback at both endpoints and interpolates within the recording', () => {
  const clip = decodeBundledMotion(recording(), schema);
  assert.deepEqual(bundledMotionFrame(clip, -5), { first: 0, second: 0, blend: 0 });
  assert.deepEqual(bundledMotionFrame(clip, 1 / 60), { first: 0, second: 1, blend: .5 });
  assert.deepEqual(bundledMotionFrame(clip, 5), { first: 1, second: 1, blend: 0 });
  assert.throws(() => bundledMotionFrame(clip, NaN), /finite/);
});
test('rejects recordings for another player rig', () => {
  assert.throws(() => decodeBundledMotion(recording(), { ...schema, rigHash: '00'.repeat(32) }), /model/);
  assert.throws(() => decodeBundledMotion(recording(), { ...schema, bones: [] }), /model/);
});
test('rejects truncated, corrupt and non-finite recordings', () => {
  assert.throws(() => decodeBundledMotion(recording().slice(0, -1), schema), /model/);
  const invalidRotation = recording();
  new DataView(invalidRotation).setInt16(70, 0, true);
  assert.throws(() => decodeBundledMotion(invalidRotation, schema), /rotation/);
  const invalidPosition = recording();
  new DataView(invalidPosition).setFloat32(52, Infinity, true);
  assert.throws(() => decodeBundledMotion(invalidPosition, schema), /position/);
  const invalidRate = recording();
  new DataView(invalidRate).setFloat32(12, NaN, true);
  assert.throws(() => decodeBundledMotion(invalidRate, schema), /model/);
  const invalidCount = recording();
  new DataView(invalidCount).setUint32(8, 0xffffffff, true);
  assert.throws(() => decodeBundledMotion(invalidCount, schema), /model/);
});
test('uses the SDK 30 Hz hit, extension and toss markers', () => {
  assert.deepEqual(bundledAnimationEvents('23 23', 'strike', 2), {
    kind: 'strike', contactTime: 23 / 30, maxExtensionTime: 23 / 30,
  });
  assert.deepEqual(bundledAnimationEvents('56 56 27', 'serve', 3), {
    kind: 'serve', contactTime: 56 / 30, maxExtensionTime: 56 / 30, tossTime: .9,
  });
});
test('does not interpret a service-waiting ready marker as ball contact', () => {
  const events = bundledAnimationEvents('10 20 30 35', 'serve-waiting', 2);
  assert.equal(events.readyTime, 10 / 30);
  assert.equal('contactTime' in events, false);
  assert.throws(() => bundledAnimationEvents('10 20 30 35', 'serve', 2), /unsupported/);
});
test('rejects missing, malformed and out-of-range source markers', () => {
  for (const value of ['', '1', 'NaN 20', '-1 20', '2e2 3', '60 61']) {
    assert.throws(() => bundledAnimationEvents(value, 'strike', 1));
  }
});
