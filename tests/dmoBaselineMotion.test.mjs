import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const court = await readFile(new URL('../components/DmoLiveCourt3D.tsx', import.meta.url), 'utf8');
const digest = (text) => createHash('sha256').update(text).digest('hex');

// These fingerprints come from the accepted PR 329 player update and motion
// modules. Strip only the explicitly isolated smash override, not whitespace or
// other logic: facing, preparation, recovery and gait must remain byte-identical.
test('ordinary player update is exactly the accepted pre-smash baseline', () => {
  const start = court.indexOf('    const updatePlayer = (');
  const end = court.indexOf('    const animate = (now: number) => {', start);
  assert.ok(start >= 0 && end > start);
  const update = court.slice(start, end);
  const overrideStart = update.indexOf('          // Smash-only override:');
  const marker = '          // End smash-only override.\n';
  const overrideEnd = update.indexOf(marker, overrideStart);
  assert.ok(overrideStart >= 0 && overrideEnd > overrideStart);
  const baseline = update.slice(0, overrideStart) + update.slice(overrideEnd + marker.length);
  assert.equal(digest(baseline), 'b3eabcf3d90ea9497f9ad7a2cafb5fee7782afc9ba13bb67a4a14c7b5508bf27');
});

test('gait, motion interpretation and native pose modules retain the accepted baseline', async () => {
  const expected = {
    'lib/liveCourtGait.ts': 'f4c79a24a344cabb2d5e9e43cb6399c650403cc97cc362c8fba4ae8f9c9d2a11',
    'lib/liveCourtMotion.ts': '860c2804abcb795ef621b372c550cc8e239fa0c80ff5409ebe4e6fb1807d56cb',
    'components/DmoNativePlayer.ts': 'c46e16dd9d72f259b12998d8a1e90ce368fdb63d2443be0959fe2e36f704c90a',
    'components/DmoCapturedLocomotion.ts': '0d11c9d0b726658bee8e223854a8840af917b04a1ff6e05414af03f7cbbb2d78',
  };
  for (const [path, fingerprint] of Object.entries(expected)) {
    assert.equal(digest(await readFile(new URL(`../${path}`, import.meta.url))), fingerprint, path);
  }
});

test('actual stroke-selection block latches normal strokes and only overrides qualifying smashes', () => {
  const start = court.indexOf('        if (capturedEvent?.frame !== strokeEvent.frame');
  const end = court.indexOf('        rig.root.userData.capturedGroundstrokeEvent = capturedEvent;', start);
  assert.ok(start >= 0 && end > start);
  const select = new Function(
    'capturedEvent', 'strokeEvent', 'handedness', 'stroke', 'strokeCue', 'isCapturedSmashShot',
    'contactSample', 'samples', 'events', 'sceneDataRef', 'TE4_DMO_FRAMES_PER_SECOND',
    `${court.slice(start, end)}\nreturn capturedEvent;`,
  );
  const choose = (previous, event, stroke, cue, qualifies, hand = 'right') => select(
    previous, event, hand, stroke, cue, () => qualifies,
    [], [], [], { current: { snapshot: { frameRate: 60 } } }, 60,
  );
  const hit = { frame: 100, shotType: 'rally' };
  const normal = choose(undefined, hit, 'forehand', 'standard', false);
  assert.equal(normal.stroke, 'forehand');
  assert.equal(choose(normal, hit, 'backhand', 'standard', false), normal,
    'changing ball side or facing cannot reselect an already latched stroke');
  assert.equal(choose(normal, hit, 'volley-backhand', 'close-net', true), normal,
    'late overhead evidence cannot interrupt the original stroke');
  assert.equal(choose(undefined, hit, 'volley-forehand', 'close-net', false).stroke, 'volley-forehand');
  assert.equal(choose(undefined, hit, 'volley-backhand', 'close-net', true).stroke, 'smash');
  assert.equal(choose(undefined, hit, 'forehand', 'standard', true).stroke, 'forehand');
  assert.equal(choose(undefined, { ...hit, shotType: 'serve' }, 'forehand', 'close-net', true).stroke, 'serve');
  assert.equal(choose(normal, { ...hit, frame: 150 }, 'backhand', 'standard', false).stroke, 'backhand');
  assert.equal(choose(normal, hit, 'backhand', 'standard', false, 'left').handedness, 'left');
});
