import assert from 'node:assert/strict';
import test from 'node:test';
import {
  replayCourtWindowDurationMs,
  replayCourtWindowFrames,
  hasCompletedDmoPoints,
  replayFrameAtElapsedTime,
  formatLivePointScore,
  Te4DmoLiveParser,
} from '../lib/te4DmoLive.ts';
import {
  DEFAULT_LIVE_COURT_CAMERA,
  findCourtRacketContact,
  playerRightVector,
  projectCourtPoint,
} from '../lib/liveCourtProjection.ts';
import { hasPlayerPositionData } from '../lib/te4LiveSetup.ts';
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
  assert.equal(snapshot.pointHistory, undefined);
  assert.deepEqual(
    parser.snapshot('match.dmo', 3, parser.frameCount, undefined, undefined, false, true)?.pointHistory,
    [],
  );
  assert.deepEqual(snapshot.winChance, [0.5, 0.5]);
  assert.equal(snapshot.stats.length, 2);
  assert.ok(snapshot.court.length > 0 && snapshot.court.length <= 96);
  assert.equal(snapshot.courtFrameIndices.length, snapshot.court.length);
  assert.deepEqual(
    snapshot.courtFrameIndices,
    Array.from({ length: snapshot.frameCount }, (_, index) => index),
  );
  assert.equal(snapshot.courtFrameCount, snapshot.frameCount);
  assert.equal(snapshot.filename, 'match.dmo');
  assert.equal(parser.snapshot('match.dmo', 1)?.bestOf, 1);

  const replayOpening = parser.snapshot('match.dmo', 3, 24);
  assert.equal(replayOpening?.frameCount, 24);
  assert.equal(replayOpening?.courtFrameCount, 24);
  assert.equal(replayOpening?.pointCount, 0);

  const shortMotionWindow = parser.snapshot('match.dmo', 3, 24, 12);
  assert.equal(shortMotionWindow?.courtFrameCount, 12);
  assert.ok(shortMotionWindow?.court.length <= 96);
});

test('live court mirrors the lateral axis for the right-handed player rigs', () => {
  const parser = new Te4DmoLiveParser();
  parser.append(syntheticDmo());
  const snapshot = parser.snapshot('match.dmo', 3);
  assert.ok(snapshot);

  const sampleIndex = snapshot.courtFrameIndices?.indexOf(10) ?? -1;
  assert.ok(sampleIndex >= 0);
  assert.equal(snapshot.court[sampleIndex][1], -Math.round(parser.ballY[10]));
  assert.equal(snapshot.court[sampleIndex][4], -Math.round(parser.player1Y[10]));
  assert.equal(snapshot.court[sampleIndex][6], -Math.round(parser.player2Y[10]));
});

test('opening DMO snapshots omit impossible court samples without rejecting valid match data', () => {
  const bytes = syntheticDmo();
  const frameLocator = new Te4DmoLiveParser();
  frameLocator.append(bytes);
  writeFixed(bytes, frameLocator.offsets[9] + 112, 16_777_472);

  const parser = new Te4DmoLiveParser();
  parser.append(bytes);

  const snapshot = parser.snapshot('match.dmo', 3, 10);
  assert.ok(snapshot);
  assert.equal(snapshot.frameCount, 10);
  assert.equal(snapshot.court.length, 9);
  assert.ok(snapshot.court.every((sample) => sample.every((value, index) => (
    index === 2 ? value >= 0 && value <= 600 : value >= -5000 && value <= 5000
  ))));
});

test('live snapshots omit ball samples with outlier heights instead of clamping them into the court', () => {
  const bytes = syntheticDmo();
  const locator = new Te4DmoLiveParser();
  locator.append(bytes);
  writeFixed(bytes, locator.offsets[10], 1_851_878_764);

  const parser = new Te4DmoLiveParser();
  parser.append(bytes);
  const snapshot = parser.snapshot('match.dmo', 3, 12, 12, 100);

  assert.ok(snapshot);
  assert.equal(snapshot.courtFrameIndices?.includes(10), false);
  assert.equal(snapshot.court.length, 11);
  assert.ok(snapshot.court.every((sample) => sample[2] <= 600));
});

test('DMO replay eligibility requires parsed completed points and advances at the chosen speed', () => {
  assert.equal(hasCompletedDmoPoints(null), false);
  assert.equal(hasCompletedDmoPoints({ pointCount: 0 }), false);
  assert.equal(hasCompletedDmoPoints({ pointCount: 1 }), true);
  assert.equal(replayFrameAtElapsedTime(1_000, 0, 1), 10);
  assert.equal(replayFrameAtElapsedTime(1_000, 1_000, 1), 70);
  assert.equal(replayFrameAtElapsedTime(1_000, 1_000, 4), 250);
  assert.equal(replayFrameAtElapsedTime(50, 100_000, 1), 50);
});

test('court motion windows overlap successive updates at every replay speed', () => {
  for (const speed of [1, 2, 4]) {
    const windowFrames = replayCourtWindowFrames(speed);
    assert.equal(windowFrames, 180 * speed);
    assert.equal(replayCourtWindowDurationMs(windowFrames, speed), 3000);
  }
});

test('point log labels use game and tennis point scores, including tiebreak scores', () => {
  assert.equal(formatLivePointScore({ games: [0, 0], points: [1, 0], tiebreak: false }), '0-0(15-0)');
  assert.equal(formatLivePointScore({ games: [3, 2], points: [1, 1], tiebreak: false }), '3-2(15-15)');
  assert.equal(formatLivePointScore({ games: [1, 4], points: [1, 3], tiebreak: false }), '1-4(15-40)');
  assert.equal(formatLivePointScore({ games: [6, 6], points: [6, 7], tiebreak: true }), '6-6(6-7)');
  assert.equal(formatLivePointScore({ games: [3, 2], points: [4, 3], tiebreak: false }), '3-2(AD-40)');
});

test('court projection remains stable around every azimuth and view elevation', () => {
  const views = [0, 90, 180, 270].map((azimuth) =>
    projectCourtPoint([320, -170, 185], { azimuth, elevation: 46 }),
  );
  for (const [x, y, scale, depth] of views) {
    assert.ok(Number.isFinite(x));
    assert.ok(Number.isFinite(y));
    assert.ok(scale > 0);
    assert.ok(depth > 0);
  }
  assert.equal(new Set(views.map(([x, y]) => `${Math.round(x)}:${Math.round(y)}`)).size, 4);

  const low = projectCourtPoint([320, -170, 185], { azimuth: 46, elevation: 5 });
  const high = projectCourtPoint([320, -170, 185], { azimuth: 46, elevation: 90 });
  assert.notEqual(Math.round(low[1]), Math.round(high[1]));
});

test('default court view keeps the positive-x end on screen-right', () => {
  const negativeEnd = projectCourtPoint([-1189, 0, 0], DEFAULT_LIVE_COURT_CAMERA);
  const positiveEnd = projectCourtPoint([1189, 0, 0], DEFAULT_LIVE_COURT_CAMERA);
  assert.ok(negativeEnd[0] < positiveEnd[0]);
});

test('racket side is the player’s right, independent of the camera view', () => {
  assert.deepEqual(playerRightVector([1, 0, 0]), [0, -1, 0]);
  const right = playerRightVector([0, 1, 0]);
  assert.ok(right.every((value, index) => Math.abs(value - [1, 0, 0][index]) < 1e-9));
});

test('racket contact pose follows recorded shot events and selects the nearest player', () => {
  const players = [
    { id: 1, x: 0, y: 0 },
    { id: 2, x: 900, y: 0 },
  ];
  const ball = { x: 12, y: 0, z: 145 };
  assert.equal(findCourtRacketContact(ball, players, { frame: 100, kind: 'shot' }, 100), 1);
  assert.equal(findCourtRacketContact(ball, players, { frame: 100, kind: 'shot' }, 104), null);
  assert.equal(findCourtRacketContact(ball, players, { frame: 100, kind: 'point-end' }, 100), null);
  assert.equal(findCourtRacketContact(ball, [], { frame: 100, kind: 'shot' }, 100), null);
  assert.equal(
    findCourtRacketContact({ x: 500, y: 0, z: 145 }, players, { frame: 100, kind: 'shot' }, 100),
    null,
  );
});

test('live court snapshots include frame-indexed rally boundaries and optional sound cues', () => {
  const bytes = syntheticDmo();
  const locator = new Te4DmoLiveParser();
  locator.append(bytes);
  const serveOffset = locator.offsets[20];
  bytes[serveOffset + 110] = 2;
  const parser = new Te4DmoLiveParser();
  parser.append(bytes);

  const silent = parser.snapshot('match.dmo', 3, 48, 72, 72);
  const sounding = parser.snapshot('match.dmo', 3, 48, 72, 72, true);
  assert.ok(silent);
  assert.ok(sounding);
  assert.equal(silent.courtFrameCount, silent.frameCount);
  assert.equal(silent.court.length, silent.frameCount);
  assert.equal(silent.courtFrameIndices.length, silent.frameCount);
  assert.equal(silent.soundEvents, undefined);
  assert.deepEqual(silent.trajectoryEvents, [
    { frame: 20, kind: 'shot', player: 1, shotType: 'serve' },
  ]);
  assert.deepEqual(sounding.soundEvents, [
    { frame: 20, kind: 'racket' },
    { frame: 25, kind: 'bounce' },
  ]);
});

test('point-end markers reset the reconstructed court trajectory', () => {
  const bytes = syntheticDmo();
  const locator = new Te4DmoLiveParser();
  locator.append(bytes);
  bytes[locator.offsets[20] + 110] = 2;
  bytes[locator.offsets[25] + 110] = 5;

  const parser = new Te4DmoLiveParser();
  parser.append(bytes);
  const snapshot = parser.snapshot('match.dmo', 3, parser.frameCount, 72, 72);

  assert.deepEqual(snapshot?.trajectoryEvents, [
    { frame: 20, kind: 'shot', player: 1, shotType: 'serve' },
    { frame: 25, kind: 'point-end' },
  ]);
});

test('invalid DMO signatures are marked instead of yielding a scoreboard', () => {
  const parser = new Te4DmoLiveParser();
  parser.append(new Uint8Array(1200));
  assert.equal(parser.header?.bad, true);
  assert.equal(parser.snapshot('invalid.dmo', 5), null);
});

test('local setup check distinguishes court positions from an empty position payload', () => {
  assert.equal(hasPlayerPositionData([[12, 4, 8, 0, 0, 0, 0]]), false);
  assert.equal(hasPlayerPositionData([[12, 4, 8, -403, -169, 1237, -176]]), true);
  assert.equal(hasPlayerPositionData([[12, 4, 8, Number.NaN, 0, 0, 0]]), false);
  assert.equal(hasPlayerPositionData([[12, 4, 8]]), false);
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
