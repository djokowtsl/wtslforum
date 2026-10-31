import assert from 'node:assert/strict';
import test from 'node:test';
import { tournamentCardTheme } from '../lib/tournamentCardTheme.mjs';

test('recognizes major-event identities before falling back to surface', () => {
  assert.equal(tournamentCardTheme('Australian Open', 'Hard'), 'australian-open');
  assert.equal(tournamentCardTheme('Roland-Garros', 'Clay'), 'roland-garros');
  assert.equal(tournamentCardTheme('French Open', 'Clay'), 'roland-garros');
  assert.equal(tournamentCardTheme('Wimbledon', 'Grass'), 'wimbledon');
  assert.equal(tournamentCardTheme('US Open', 'Hard'), 'us-open');
  assert.equal(tournamentCardTheme('Indian Wells Masters', 'Hard'), 'indian-wells');
});

test('uses court-surface palettes for other ATP, ITF, and WTA events', () => {
  assert.equal(tournamentCardTheme('Tour event', 'Indoor Hard'), 'indoor');
  assert.equal(tournamentCardTheme('Tour event', 'Carpet'), 'indoor');
  assert.equal(tournamentCardTheme('Tour event', 'Grass'), 'grass');
  assert.equal(tournamentCardTheme('Tour event', 'Clay'), 'clay');
  assert.equal(tournamentCardTheme('Tour event', 'Hard'), 'hard');
});

test('unknown event identities and surfaces keep a neutral theme', () => {
  assert.equal(tournamentCardTheme('Unknown event', null), 'classic');
  assert.equal(tournamentCardTheme(null, 'Unknown'), 'classic');
});
