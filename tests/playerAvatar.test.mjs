import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolvePlayerAvatar,
  WTSL_PLAYER_AVATAR_FALLBACK,
} from '../lib/playerAvatar.ts';

test('uses the WTSL logo when a player avatar is missing or blank', () => {
  for (const src of [null, undefined, '', '   ']) {
    assert.deepEqual(resolvePlayerAvatar(src, null), {
      src: WTSL_PLAYER_AVATAR_FALLBACK,
      isFallback: true,
    });
  }
});

test('keeps a usable player avatar URL', () => {
  assert.deepEqual(resolvePlayerAvatar(' https://example.com/player.png ', null), {
    src: 'https://example.com/player.png',
    isFallback: false,
  });
});

test('switches to the WTSL logo after an avatar URL fails to load', () => {
  assert.deepEqual(
    resolvePlayerAvatar('https://example.com/missing.png', 'https://example.com/missing.png'),
    { src: WTSL_PLAYER_AVATAR_FALLBACK, isFallback: true },
  );
});
