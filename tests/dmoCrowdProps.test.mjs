import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  CROWD_PROP_SHARES,
  CROWD_SIGN_MESSAGES,
  crowdCapColorFor,
  crowdPropFor,
  crowdSignMessageFor,
} from '../lib/dmoCrowdProps.mjs';

test('some of the crowd have caps, drinks, snacks or signs, fixed per seat', () => {
  const counts = {};
  for (let seat = 0; seat < 20000; seat++) {
    const prop = crowdPropFor(seat, seat % 20);
    counts[prop] = (counts[prop] ?? 0) + 1;
    assert.equal(crowdPropFor(seat, seat % 20), prop, 'the same person always has the same thing');
  }
  for (const [prop, share] of Object.entries(CROWD_PROP_SHARES)) {
    assert.ok(Math.abs(counts[prop] / 20000 - share) < share * 0.25, `${prop}: ${counts[prop]}`);
  }
  assert.ok(counts.null / 20000 > 0.8, 'most people have nothing');
  assert.equal(crowdPropFor(-1), null);
  const messages = new Set(Array.from({ length: 400 }, (_, seat) => crowdSignMessageFor(seat)));
  assert.equal(messages.size, CROWD_SIGN_MESSAGES.length, 'every message appears');
  assert.ok(Number.isInteger(crowdCapColorFor(5)));
});

test('the court gets its props from the spectators, not from fixed-height accessories', async () => {
  const court = await readFile(new URL('../components/DmoLiveCourt3D.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(court, /addCrowdAccessories\(scene, crowdRig\)/, 'caps were at a fixed height and stayed over empty seats');
  const crowd = await readFile(new URL('../components/DmoSpectatorCrowd.ts', import.meta.url), 'utf8');
  assert.match(crowd, /const props = createCrowdProps\(scene, crowd\);/);
  assert.match(crowd, /props\.place\(prop, source, dummy\.matrix, anchor, gazeAngle, raisingSign\)/,
    'props use the same seat transform as the person');
  assert.match(crowd, /part\.makeRotationY\(gaze\)/, 'caps turn with the head');
  assert.doesNotMatch(crowd, /Coca|Pepsi|Nike|Adidas|Rolex|Emirates/i, 'no real-world brands');
  const pose = await readFile(new URL('../components/DmoSpectatorPose.ts', import.meta.url), 'utf8');
  assert.match(pose, /applause === 'sign'/);
});
