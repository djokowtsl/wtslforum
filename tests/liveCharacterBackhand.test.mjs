import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  inferredOneHandedBackhandPlayer,
  resolveBroadcastStrokeStyles,
} from '../lib/liveCharacterBackhand.mjs';

test('applies a selected character backhand to its DMO player slot regardless of names', () => {
  const players = ['A. Player', 'Roger Federer'];
  assert.equal(inferredOneHandedBackhandPlayer(players, 0, 'one-handed'), 0);
  assert.equal(inferredOneHandedBackhandPlayer(players, 1, 'one-handed'), 1);
});

test('does not infer a style for two-handed profiles or invalid player slots', () => {
  const players = ['Player One', 'Player Two'];
  assert.equal(inferredOneHandedBackhandPlayer(players, 0, 'two-handed'), null);
  assert.equal(inferredOneHandedBackhandPlayer(players, 1, null), null);
  assert.equal(inferredOneHandedBackhandPlayer(players, 2, 'one-handed'), null);
  assert.equal(inferredOneHandedBackhandPlayer(null, 0, 'one-handed'), null);
});

test('applies same-character selections to both slots while preserving manual overrides', () => {
  const styles = [
    { forehand: 'two', backhand: 'two' },
    { forehand: 'one', backhand: 'two' },
  ];
  assert.deepEqual(
    resolveBroadcastStrokeStyles(
      ['Different DMO name', 'Another DMO name'],
      styles,
      ['one-handed', 'one-handed'],
      [false, false],
    ),
    [
      { forehand: 'two', backhand: 'one' },
      { forehand: 'one', backhand: 'one' },
    ],
  );
  assert.deepEqual(
    resolveBroadcastStrokeStyles(
      ['Different DMO name', 'Another DMO name'],
      styles,
      ['one-handed', 'one-handed'],
      [false, true],
    ),
    [
      { forehand: 'two', backhand: 'one' },
      { forehand: 'one', backhand: 'two' },
    ],
  );
});

test('manual and automatic broadcasts wait for selected profiles to finish loading', async () => {
  const host = await readFile(new URL('../components/DmoLiveHost.tsx', import.meta.url), 'utf8');
  assert.match(host, /characterBackhandStatusRef\.current === 'loading'/);
  assert.match(host, /disabled=\{[\s\S]*characterBackhandStatus === 'loading'/);
});
