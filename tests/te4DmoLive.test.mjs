import assert from 'node:assert/strict';
import test from 'node:test';
import { Te4DmoLiveParser } from '../lib/te4DmoLive.ts';
import { isSameSiteMutation } from '../lib/liveRequestSecurity.ts';

const UINT32_SCALE = 0x100000000;

function writeFixed(buffer, offset, value) {
  const high = Math.trunc(value);
  const fraction = value - high;
  buffer.writeUInt32LE(Math.floor(fraction * UINT32_SCALE), offset);
  buffer.writeInt32LE(high, offset + 4);
}

function syntheticDmo() {
  const firstFrame = 0x1200;
  const frameCount = 48;
  const buffer = Buffer.alloc(firstFrame + frameCount * 128 + 1200);
  Buffer.from('\x0fDemoTEM2-1.0g.0', 'binary').copy(buffer);
  Buffer.from('0115 Tokyo ATP 500', 'ascii').copy(buffer, 24);
  Buffer.from('HUD_TEST', 'ascii').copy(buffer, 100);
  Buffer.from('Victor', 'ascii').copy(buffer, 112);
  Buffer.from('Vic', 'ascii').copy(buffer, 120);
  Buffer.from('Rafa', 'ascii').copy(buffer, 125);
  Buffer.from('Raf', 'ascii').copy(buffer, 131);
  buffer.fill(0xff, 0x1000, firstFrame);

  for (let index = 0; index < frameCount; index += 1) {
    const offset = firstFrame + index * 128;
    writeFixed(buffer, offset, 15);
    writeFixed(buffer, offset + 8, -300 + index);
    writeFixed(buffer, offset + 16, 1189);
    writeFixed(buffer, offset + 32, 300 - index);
    writeFixed(buffer, offset + 40, -1189);
    writeFixed(buffer, offset + 56, 80);
    writeFixed(buffer, offset + 64, 25);
    writeFixed(buffer, offset + 72, 90);
    writeFixed(buffer, offset + 80, 78);
    writeFixed(buffer, offset + 88, 22);
    writeFixed(buffer, offset + 96, 90);
    writeFixed(buffer, offset + 112, index * 2);
    writeFixed(buffer, offset + 120, index * 3);
  }
  return buffer;
}

test('incremental DMO parsing waits for frames, then emits a compact live snapshot', () => {
  const bytes = syntheticDmo();
  const parser = new Te4DmoLiveParser();
  parser.append(bytes.subarray(0, 0x1800));
  assert.equal(parser.snapshot('match.dmo', 3), null);

  parser.append(bytes.subarray(0x1800));
  const snapshot = parser.snapshot('match.dmo', 3);
  assert.ok(snapshot);
  assert.deepEqual(snapshot.players, ['Victor', 'Rafa']);
  assert.equal(snapshot.stadium, 'Tokyo ATP 500');
  assert.ok(snapshot.frameCount > 10);
  assert.equal(snapshot.bestOf, 3);
  assert.equal(snapshot.pointCount, 0);
  assert.deepEqual(snapshot.winChance, [0.5, 0.5]);
  assert.equal(snapshot.stats.length, 2);
  assert.ok(snapshot.court.length > 0 && snapshot.court.length <= 25);
  assert.equal(snapshot.filename, 'match.dmo');
});

test('invalid DMO signatures are marked instead of yielding a scoreboard', () => {
  const parser = new Te4DmoLiveParser();
  parser.append(new Uint8Array(1200));
  assert.equal(parser.header?.bad, true);
  assert.equal(parser.snapshot('invalid.dmo', 5), null);
});

test('live writes require a matching same-site Origin and forwarded host', () => {
  const allowed = new Request('https://forum.example/api/admin/dmo-live', {
    method: 'POST',
    headers: {
      Origin: 'https://forum.example',
      'X-Forwarded-Host': 'forum.example',
      'X-Forwarded-Proto': 'https',
    },
  });
  const rejected = new Request('https://forum.example/api/admin/dmo-live', {
    method: 'POST',
    headers: {
      Origin: 'https://attacker.example',
      'X-Forwarded-Host': 'forum.example',
      'X-Forwarded-Proto': 'https',
    },
  });
  assert.equal(isSameSiteMutation(allowed), true);
  assert.equal(isSameSiteMutation(rejected), false);
});
