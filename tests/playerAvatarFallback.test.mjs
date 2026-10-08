import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolvePlayerAvatarSource,
  WTSL_PLAYER_AVATAR_FALLBACK,
} from '../lib/playerAvatar.ts';

test('match-card fallback uses the WTSL brand logo', () => {
  assert.equal(WTSL_PLAYER_AVATAR_FALLBACK, '/brand/wtsl-logo-200.png');
});

test('a real player avatar takes precedence over the fallback', () => {
  assert.deepEqual(
    resolvePlayerAvatarSource(' https://example.com/player.png ', WTSL_PLAYER_AVATAR_FALLBACK),
    { src: 'https://example.com/player.png', isFallback: false },
  );
});

test('missing and blank player avatars use the supplied WTSL fallback', () => {
  assert.deepEqual(
    resolvePlayerAvatarSource(null, WTSL_PLAYER_AVATAR_FALLBACK),
    { src: WTSL_PLAYER_AVATAR_FALLBACK, isFallback: true },
  );
  assert.deepEqual(
    resolvePlayerAvatarSource('   ', WTSL_PLAYER_AVATAR_FALLBACK),
    { src: WTSL_PLAYER_AVATAR_FALLBACK, isFallback: true },
  );
});

test('other player avatars keep the existing initials fallback when none is supplied', () => {
  assert.deepEqual(resolvePlayerAvatarSource(null), { src: null, isFallback: false });
});
