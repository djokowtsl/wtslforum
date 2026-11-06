import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import {
  createVoiceRoomSignature,
  isValidVoiceRoom,
  normalizeVoiceRoomName,
  voiceRoomForBroadcast,
} from '../lib/voiceRoomToken.ts';

const require = createRequire(import.meta.url);
const { signRoomToken, verifyRoomToken } = require('../services/voice-room/server.js');
const secret = 'a'.repeat(64);

test('broadcast IDs become stable, valid room codes', () => {
  assert.equal(voiceRoomForBroadcast('550E8400-E29B-41D4-A716-446655440000'), '550e8400-e29b-41d4-a716-446655440000');
  assert.equal(voiceRoomForBroadcast('x'), '');
  assert.equal(isValidVoiceRoom('match-42'), true);
  assert.equal(isValidVoiceRoom('../other'), false);
});

test('Forum and voice server normalize the same display names', () => {
  assert.equal(normalizeVoiceRoomName('  Vic<tor>\u0007 George '), 'Victor George');
  assert.equal(normalizeVoiceRoomName(''), 'Player');
});

test('room-token issuance preserves the livestream admin-only restriction', () => {
  const route = fs.readFileSync(new URL('../app/api/voice-token/route.ts', import.meta.url), 'utf8');
  assert.match(route, /if \(!user\.isAdmin\)/);
  assert.match(route, /status: 403/);
});

test('Forum token signatures match the server and bind room, name, and expiry', () => {
  const now = 1_800_000_000;
  const exp = now + 300;
  const name = 'Victor George';
  const sig = createVoiceRoomSignature(secret, 'match-42', exp, name);

  assert.equal(sig, signRoomToken(secret, 'match-42', exp, name));
  assert.equal(verifyRoomToken(secret, 'match-42', exp, name, sig, now), true);
  assert.equal(verifyRoomToken(secret, 'other-42', exp, name, sig, now), false);
  assert.equal(verifyRoomToken(secret, 'match-42', exp, 'Someone else', sig, now), false);
  assert.equal(verifyRoomToken(secret, 'match-42', exp + 1, name, sig, now), false);
  assert.equal(verifyRoomToken(secret, 'match-42', now - 120, name, sig, now), false);
  assert.equal(verifyRoomToken(secret, 'match-42', now + 7 * 60 * 60, name, sig, now), false);
  assert.equal(verifyRoomToken(secret, 'match-42', exp, name, 'not-a-signature', now), false);
});
