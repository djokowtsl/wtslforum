// Round 24–26: the beaten player's stretch for a ball going past him, and the
// live playhead's soft 2 s cushion on top of the 1.2 s DMO-update floor.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  advanceLiveCourtPlayhead,
  withReachAttempts,
  LIVE_CUSHION_SECONDS,
  LIVE_CUSHION_REBUILD_SPEED,
} from '../lib/liveCourtMotion.ts';

test('the beaten player stretches for a winner or an ace, not for a ball going out or a fault', () => {
  const fps = 30;
  // Player 2 at x = -1200, y = 0. Ball hit by player 1 at frame 0 from x = 1200,
  // travelling to -1500 over 30 frames; it passes him `side` cm to the side,
  // bouncing (z dips to 5) at bounceX.
  const flight = (side, bounceX) => Array.from({ length: 31 }, (_, k) => {
    const x = 1200 - k * 90;
    const z = Math.abs(x - bounceX) < 50 ? 5 : 100;
    return { frame: k, values: [x, side, z, 1200, 0, -1200, 0] };
  });
  const rally = [{ frame: 0, kind: 'shot', player: 1, shotType: 'rally' }, { frame: 60, kind: 'point-end' }];
  // A winner 2 m to his side, bouncing in: an attempt as it passes him.
  const winner = withReachAttempts(rally, flight(200, -900), fps);
  const attempt = winner.find(e => e.attempt);
  assert.ok(attempt && attempt.player === 2 && attempt.frame >= 26 && attempt.frame <= 28, 'stretch for the winner');
  // Bouncing out wide (5 m to the side): he lets it go.
  assert.ok(!withReachAttempts(rally, flight(500, -900), fps).some(e => e.attempt), 'no swing at a ball going out');
  // Close to him (TE4 would have him play it) or far out of reach: none.
  assert.ok(!withReachAttempts(rally, flight(40, -900), fps).some(e => e.attempt));
  // A serve fault (another serve follows): none. An ace (bounces in the box): one.
  const fault = [{ frame: 0, kind: 'shot', player: 1, shotType: 'serve' }, { frame: 90, kind: 'shot', player: 1, shotType: 'serve' }];
  assert.ok(!withReachAttempts(fault, flight(150, -500), fps).some(e => e.attempt), 'no swing at a fault');
  const ace = [{ frame: 0, kind: 'shot', player: 1, shotType: 'serve' }, { frame: 90, kind: 'point-end' }];
  assert.ok(withReachAttempts(ace, flight(150, -500), fps).some(e => e.attempt), 'a stretch for an ace');
  // A double fault landing past the service line: none.
  assert.ok(!withReachAttempts(ace, flight(150, -900), fps).some(e => e.attempt), 'no swing at a long serve');
  // TE4's swing after the ball has gone past him is replaced by the attempt.
  const late = [{ frame: 0, kind: 'shot', player: 1, shotType: 'rally' }, { frame: 45, kind: 'shot', player: 2, shotType: 'rally' }, { frame: 60, kind: 'point-end' }];
  const replaced = withReachAttempts(late, flight(200, -900), fps);
  assert.ok(replaced.some(e => e.attempt) && !replaced.some(e => e.frame === 45), 'late swing replaced');
  // He played it (his shot as it reached him): unchanged.
  const played = [{ frame: 0, kind: 'shot', player: 1, shotType: 'rally' }, { frame: 26, kind: 'shot', player: 2, shotType: 'rally' }];
  assert.equal(withReachAttempts(played, flight(200, -900), fps), played);
});

test('live attempts: none whose moment is within 0.3 s of the end of the data received', () => {
  const fps = 30;
  const flight = Array.from({ length: 31 }, (_, k) => {
    const x = 1200 - k * 90;
    return { frame: k, values: [x, 200, Math.abs(x + 900) < 50 ? 5 : 100, 1200, 0, -1200, 0] };
  });
  const rally = [{ frame: 0, kind: 'shot', player: 1, shotType: 'rally' }, { frame: 60, kind: 'point-end' }];
  assert.ok(withReachAttempts(rally, flight, fps, 60).some(e => e.attempt), 'known in time');
  assert.ok(!withReachAttempts(rally, flight, fps, 30).some(e => e.attempt), 'too close to the data end');
});

test('live playback: soft 2 s cushion over the hard 1.2 s floor, measured from the newest frame (no stacking)', () => {
  const samples = Array.from({ length: 61 }, (_, k) => ({ frame: k * 10, values: [0, 0, 0, 0, 0, 0, 0] })); // frames 0..600
  const fps = 60, floor = 72, cushion = LIVE_CUSHION_SECONDS * fps; // 72 and 120 frames
  // Well behind (300 frames): normal speed.
  assert.equal(advanceLiveCourtPlayhead(300, 50, 1, samples, fps, floor, cushion), 303);
  // 100 frames behind (inside the 2 s cushion, outside the floor): 80% speed.
  assert.ok(Math.abs(advanceLiveCourtPlayhead(500, 50, 1, samples, fps, floor, cushion) - (500 + 3 * LIVE_CUSHION_REBUILD_SPEED)) < 1e-9);
  // 2 s + a bit behind: full speed again, so the gap settles at 2 s, not 2 + 1.2 s.
  assert.equal(advanceLiveCourtPlayhead(470, 50, 1, samples, fps, floor, cushion), 473);
  // The floor still holds: never closer than 72 frames to the newest one.
  assert.equal(advanceLiveCourtPlayhead(527, 50, 1, samples, fps, floor, cushion), 528);
  assert.equal(advanceLiveCourtPlayhead(600, 50, 1, samples, fps, floor, cushion), 528);
  // Without a cushion: the floor alone, unchanged.
  assert.equal(advanceLiveCourtPlayhead(500, 50, 1, samples, fps, floor), 503);
});
