// Round 28: a ball taken before its bounce near the service line is a volley,
// whatever the backhand style (at 4.2 m only, a two-hander's service-line
// volleys were played as two-handed drives).
import assert from 'node:assert/strict';
import test from 'node:test';
import { isCapturedVolleyShot, VOLLEY_MAX_NET_DISTANCE } from '../lib/dmoVolley.ts';

// Player 1 at x = `at` cm (his side is +x), the ball coming from player 2's side
// unbounced and reaching him 70 cm to his side.
function flight(at) {
  const steps = Math.round((at + 900) / 100);
  const event = { frame: steps * 5, kind: 'shot', shotType: 'rally', player: 1 };
  const events = [{ frame: 0, kind: 'shot', shotType: 'rally', player: 2 }, event];
  const samples = Array.from({ length: steps + 1 }, (_, i) => ({
    frame: i * 5, values: [-900 + i * 100, 70, 150 - i * 3, at, 0, -900, 0],
  }));
  return isCapturedVolleyShot(event, samples.at(-1).values, samples, events, [], 60);
}

test('volleys up to the service line and a little behind it', () => {
  assert.equal(VOLLEY_MAX_NET_DISTANCE, 8);
  assert.equal(flight(300), true, 'close to the net');
  assert.equal(flight(600), true, 'on the service line');
  assert.equal(flight(700), true, 'just behind it');
  assert.equal(flight(1000), false, 'deep in the court: a groundstroke');
});
