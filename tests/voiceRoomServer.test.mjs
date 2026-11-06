import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createVoiceServer, signRoomToken } = require('../services/voice-room/server.js');
const secret = 'b'.repeat(64);
let server;
let origin;

before(async () => {
  server = createVoiceServer({
    roomSecret: secret,
    frameAncestors: ['https://wtslforum.com', 'https://www.wtslforum.com'],
    maxPeers: 2,
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

function joinUrl({ room = 'match-42', id = 'player-1', name = 'Victor', exp, sig }) {
  const url = new URL('/api/join', origin);
  url.searchParams.set('room', room);
  url.searchParams.set('id', id);
  url.searchParams.set('name', name);
  url.searchParams.set('exp', String(exp));
  url.searchParams.set('sig', sig);
  return url;
}

test('requires a strong secret and an explicit non-wildcard embed allowlist', () => {
  assert.throws(() => createVoiceServer({
    roomSecret: 'short',
    frameAncestors: ['https://www.wtslforum.com'],
  }), /ROOM_SECRET/);
  assert.throws(() => createVoiceServer({
    roomSecret: secret,
    frameAncestors: '*',
  }), /Invalid FRAME_ANCESTORS/);
  assert.throws(() => createVoiceServer({
    roomSecret: secret,
    frameAncestors: ['https://www.wtslforum.com'],
    maxPeers: 9,
  }), /MAX_PEERS/);
});

test('serves the embedded page with referrer protection and exact frame ancestors', async () => {
  const response = await fetch(`${origin}/`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-security-policy'),
    'frame-ancestors https://wtslforum.com https://www.wtslforum.com');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.match(await response.text(), /RTCPeerConnection/);
});

test('denies invalid, expired, cross-room, and renamed room tokens', async () => {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 300;
  const valid = signRoomToken(secret, 'match-42', exp, 'Victor');
  const cases = [
    { room: 'match-42', name: 'Victor', exp, sig: 'f'.repeat(64) },
    { room: 'other-42', name: 'Victor', exp, sig: valid },
    { room: 'match-42', name: 'Impersonator', exp, sig: valid },
    { room: 'match-42', name: 'Victor', exp: now - 120, sig: signRoomToken(secret, 'match-42', now - 120, 'Victor') },
  ];

  for (const token of cases) {
    const response = await fetch(joinUrl(token));
    assert.equal(response.status, 200);
    assert.match(await response.text(), /event: denied/);
  }
});

test('keeps an authorized event stream open until its client disconnects', async () => {
  const exp = Math.floor(Date.now() / 1000) + 300;
  const sig = signRoomToken(secret, 'match-42', exp, 'Victor');
  const controller = new AbortController();
  const response = await fetch(joinUrl({ room: 'match-42', id: 'player-1', name: 'Victor', exp, sig }), {
    signal: controller.signal,
  });
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  const first = await reader.read();
  assert.match(new TextDecoder().decode(first.value), /event: welcome/);
  const active = await fetch(`${origin}/health`).then((result) => result.json());
  assert.equal(active.rooms, 1);

  await reader.cancel();
  controller.abort();
  await new Promise((resolve) => setTimeout(resolve, 20));
  const closed = await fetch(`${origin}/health`).then((result) => result.json());
  assert.equal(closed.rooms, 0);
});

test('rejects cross-origin signaling requests', async () => {
  const response = await fetch(`${origin}/api/signal`, {
    method: 'POST',
    headers: {
      Origin: 'https://attacker.example',
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  assert.equal(response.status, 403);
});
