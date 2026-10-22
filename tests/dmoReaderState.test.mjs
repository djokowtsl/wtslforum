import assert from 'node:assert/strict';
import test from 'node:test';
import { consumePendingDmoReaderReset } from '../lib/dmoReaderState.ts';

test('manual start resets the DMO reader state left by folder pre-scanning', () => {
  const pendingReset = { current: true };
  const reader = {
    parser: { current: { frames: 240 } },
    activeFilename: { current: 'LastGame.dmo' },
    readBytes: { current: 2_400_000 },
    lastSentVersion: { current: 19 },
  };

  assert.equal(consumePendingDmoReaderReset(pendingReset, reader), true);
  assert.equal(pendingReset.current, false);
  assert.equal(reader.parser.current, null);
  assert.equal(reader.activeFilename.current, '');
  assert.equal(reader.readBytes.current, 0);
  assert.equal(reader.lastSentVersion.current, -1);
  assert.equal(consumePendingDmoReaderReset(pendingReset, reader), false);
});
