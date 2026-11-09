// Round 27: slices (and touch shots) are only chosen when the player tells the
// court renderer the volley recordings are there. A refactor dropped that flag
// and no slice was ever played (one-handers still looked like it, two-handers
// showed plain drives); the selection test passed because it set the flag itself.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = name => readFile(new URL(`../components/${name}`, import.meta.url), 'utf8');

test('both native players tell the court the volley recordings (slice stand-ins) are loaded', async () => {
  for (const name of ['DmoNativePlayer.ts', 'DmoNativePlayerClaude.ts']) {
    assert.match(await source(name), /rig\.root\.userData\.capturedVolleys\s*=\s*capturedGroundstroke\.hasVolleys/, name);
  }
  assert.match(await source('DmoCapturedGroundstroke.ts'), /get hasVolleys\(\)/);
  assert.match(await source('DmoLiveCourt3D.tsx'), /rig\.root\.userData\.capturedVolleys/,
    'the court still gates slices on the flag');
});
