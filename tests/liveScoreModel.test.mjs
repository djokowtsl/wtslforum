import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveLivePlayer } from '../lib/liveScoreModel.ts';

test('live player resolution keeps exact normalized ranked names', () => {
  const franky = { id: '917', name: 'Franky Franchicha' };
  const players = new Map([
    ['franky franchicha', franky],
    ['thetinkerman_', { id: '1216', name: 'TheTinkerman_' }],
  ]);

  assert.equal(resolveLivePlayer('franky franchicha', players), franky);
  assert.equal(resolveLivePlayer('thetinkerman_', players).id, '1216');
});

test('an initial-and-surname live name resolves to a unique ranked player', () => {
  const franky = { id: '917', name: 'Franky Franchicha' };
  const players = new Map([['franky franchicha', franky]]);

  assert.equal(resolveLivePlayer('f.franchicha', players), franky);
  assert.equal(resolveLivePlayer('f. franchicha', players), franky);
});

test('an ambiguous initial-and-surname live name remains unresolved', () => {
  const players = new Map([
    ['franky franchicha', { id: '917', name: 'Franky Franchicha' }],
    ['felix franchicha', { id: '918', name: 'Felix Franchicha' }],
  ]);

  assert.equal(resolveLivePlayer('f.franchicha', players), null);
});

test('unmatched or unsupported abbreviations do not guess a ranked player', () => {
  const players = new Map([
    ['franky franchicha', { id: '917', name: 'Franky Franchicha' }],
    ['juan martin del potro', { id: '919', name: 'Juan Martin del Potro' }],
  ]);

  assert.equal(resolveLivePlayer('x.unknown', players), null);
  assert.equal(resolveLivePlayer('f.franchicha extra', players), null);
  assert.equal(resolveLivePlayer('f.del potro', players), null);
});
