import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { otherEndPlayerView, swapCourtEnd } from '../lib/dmoCameraInteraction.ts';

test('swapping ends moves a camera to the matching spot at the other end', () => {
  assert.deepEqual(swapCourtEnd({ x: 35, y: 11, z: 0 }), { x: -35, y: 11, z: -0 });
  assert.deepEqual(swapCourtEnd({ x: -18, y: 8, z: 19 }), { x: 18, y: 8, z: -19 });
  const point = { x: 3, y: 2, z: -7 };
  assert.deepEqual(swapCourtEnd(swapCourtEnd(point)), point, 'twice is back to the start');
});

test("a player camera from the other end is the other player's same camera", () => {
  assert.equal(otherEndPlayerView('player-one-first'), 'player-two-first');
  assert.equal(otherEndPlayerView('player-one-third'), 'player-two-third');
  assert.equal(otherEndPlayerView('player-two-first'), 'player-one-first');
  assert.equal(otherEndPlayerView('player-two-third'), 'player-one-third');
  assert.equal(otherEndPlayerView('tv'), 'tv');
});

test('every camera offers Swap ends, and presets keep the chosen end', () => {
  const court = readFileSync(new URL('../components/DmoLiveCourt3D.tsx', import.meta.url), 'utf8');
  assert.match(court, /aria-pressed=\{endsSwapped\}\s+onClick=\{requestSwapEnds\}/);
  assert.match(court, /if \(endsSwappedRef\.current && !view\.startsWith\('player-'\)\)/, 'presets');
  assert.match(court, /if \(endsSwappedRef\.current && \(activeView === 'court' \|\| activeView === 'tv' \|\| activeView === 'aerial'\)\)/, 'resizing');
  assert.match(court, /swapCourtEnd\(controls.target\)/, 'custom camera target rotates too');
  assert.match(court, /addEventListener\('courtswapends', swapEnds\)/);
  assert.match(court, /removeEventListener\('courtswapends', swapEnds\)/);
});
