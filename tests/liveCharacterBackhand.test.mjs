import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  inferredOneHandedBackhandPlayer,
  resolveBroadcastStrokeStyles,
  characterBroadcastSetup,
  resolveBroadcastHandedness,
} from '../lib/liveCharacterBackhand.mjs';

test('Nadal metadata applies a left hand and retains the detected two-handed backhand', () => {
  const setup = characterBroadcastSetup({
    playing_hand: 'left', backhand_type: 'two-handed',
  });
  assert.deepEqual(setup, { playingHand: 'left', backhandType: 'two-handed' });
  const hands = ['right', 'right'];
  assert.deepEqual(resolveBroadcastHandedness(
    ['DMO broadcaster', 'Opponent'], hands, [setup.playingHand, 'right'], [false, false],
  ), ['left', 'right']);
  assert.deepEqual(hands, ['right', 'right'], 'does not mutate manual settings');
  assert.deepEqual(resolveBroadcastHandedness(
    ['DMO broadcaster', 'Opponent'], hands, ['right', 'left'], [false, false],
  ), ['right', 'left'], 'changing characters refreshes both slots');
  assert.deepEqual(resolveBroadcastHandedness(
    ['DMO broadcaster', 'Opponent'], hands, ['left', 'left'], [true, false],
  ), ['right', 'left'], 'explicit manual overrides remain available');
  assert.deepEqual(characterBroadcastSetup({}), { playingHand: null, backhandType: null });
});

test('host uses full-roster hand metadata and publishes setup changes without waiting for new frames', async () => {
  const host = await readFile(new URL('../components/DmoLiveHost.tsx', import.meta.url), 'utf8');
  assert.match(host, /body\.character_filter_metadata/);
  assert.match(host, /characterBroadcastSetup\(body\?\.profile\)/);
  assert.equal((host.match(/handedness: resolveBroadcastHandedness\(/g) ?? []).length, 5);
  assert.match(host, /lastHeartbeat\.current = 0;\s*\}, \[characterHands, characterBackhandTypes, playerHands, playerStrokeStyles\]/);
});

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
