import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { selectDmoPlayerKitIndices } from '../lib/dmoPlayerWardrobe.mjs';

const [courtSource, replaySource] = await Promise.all([
  readFile(new URL('../components/DmoLiveCourt3D.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../components/Te4DmoReplayPlayer.tsx', import.meta.url), 'utf8'),
]);

test('wardrobe selection is stable for the same replay and player names', () => {
  const first = selectDmoPlayerKitIndices('replay-123', ['Player One', 'Player Two'], 16);
  assert.deepEqual(selectDmoPlayerKitIndices('replay-123', ['Player One', 'Player Two'], 16), first);
  assert.notDeepEqual(selectDmoPlayerKitIndices('replay-456', ['Player One', 'Player Two'], 16), first);
});

test('two players in the same match receive different kits when options are available', () => {
  const [first, second] = selectDmoPlayerKitIndices('replay-123', ['Player One', 'Player Two'], 16);
  assert.notEqual(first, second);
});

test('wardrobe selection handles a single available kit and an empty collection', () => {
  assert.deepEqual(selectDmoPlayerKitIndices('match', ['A', 'B'], 1), [0, 0]);
  assert.deepEqual(selectDmoPlayerKitIndices('match', ['A', 'B'], 0), [0, 0]);
});

test('replay courts choose an outfit collection by tour and pass a stable replay seed', () => {
  assert.match(courtSource, /isWta \? WTA_PLAYER_KITS : ATP_PLAYER_KITS/);
  assert.match(courtSource, /selectDmoPlayerKitIndices\(/);
  assert.match(courtSource, /playerKits\[playerKitIndices\[0\]\]/);
  assert.match(courtSource, /playerKits\[playerKitIndices\[1\]\]/);
  assert.match(replaySource, /playerOutfitSeed=\{replayUrl \|\| broadcastId \|\| snapshot\.filename\}/);
});
