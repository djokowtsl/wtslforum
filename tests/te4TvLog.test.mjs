import assert from 'node:assert/strict';
import test from 'node:test';
import { alignTe4TvLog } from '../lib/te4TvLog.ts';

const points = [
  { k: 1, s: 1, w: 1 },
  { k: 2, s: 2, w: 2 },
  { k: 3, s: 1, w: 1 },
];

const log = [
  '2026-10-20 12:00:00 TE4TV POINT n=10 winner=2 srvnum=2 nbstrike=5 srv1spd=182.5 rallysec=4.2',
  '2026-10-20 12:00:00 TE4TV SHOT n=10 long=1 wide=0 net=0 speed=93',
  '2026-10-20 12:00:05 TE4TV POINT n=11 winner=1 srvnum=1 nbstrike=4',
  '2026-10-20 12:00:05 TE4TV SHOT n=11 long=0 wide=1 net=0',
  '2026-10-20 12:00:10 TE4TV POINT n=12 winner=2 srvnum=2 nbstrike=7',
  '2026-10-20 12:00:10 TE4TV SHOT n=12 long=0 wide=0 net=2',
].join('\n');

test('automatically aligns, flips player numbering, and enriches only reliable log matches', () => {
  const result = alignTe4TvLog(log, points);
  assert.equal(result.offset, 9);
  assert.equal(result.flippedPlayers, true);
  assert.equal(result.matchedPoints, 3);
  assert.equal(result.winnerAgreements, 3);
  assert.equal(result.reliable, true);
  assert.equal(result.serverAgreements, 3);
  assert.equal(result.byPoint[1].gameStats.nbstrike, 5);
  assert.equal(result.byPoint[1].gameStats.srv1spd, 182.5);
  assert.equal(result.byPoint[1].errorKind, 'long');
  assert.equal(result.byPoint[2].errorKind, 'wide');
  assert.equal(result.byPoint[3].errorKind, 'net');
  assert.equal(result.byPoint[3].isError, true);
});

test('an explicit offset is honored and weak alignments are excluded', () => {
  const result = alignTe4TvLog(log, points, 0);
  assert.equal(result.offset, 0);
  assert.equal(result.reliable, false);
  assert.deepEqual(result.byPoint, {});
});
