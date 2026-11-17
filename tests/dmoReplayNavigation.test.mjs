import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  DMO_REPLAY_SPEEDS,
  buildDmoReplayPointIndex,
  describeDmoReplayPoint,
  dmoReplayAdjacentPointFrame,
  dmoReplayMomentFrame,
  dmoReplayMomentUrl,
  dmoReplayPointAt,
  dmoReplaySeekMarkers,
  formatDmoReplayMoment,
  normalizeDmoReplaySpeed,
  parseDmoReplayMoment,
  stepDmoReplaySpeed,
} from '../lib/dmoReplayNavigation.mjs';
import {
  DMO_BROADCAST_SETTINGS_KEY,
  readDmoBroadcastSettings,
  sanitizeDmoBroadcastSettings,
  saveDmoBroadcastSettings,
} from '../lib/dmoBroadcastSettings.mjs';

const shot = (p) => ({ p });
// Set 1: a held game for player 1 (2 points), a break by player 1 (1 point),
// then set 2 starts; the last point wins the match.
const points = [
  { k: 0, mf: 100, fc: 300, set: 1, g: '0-0', pt: '0-0', tb: 0, s: 1, w: 1, f: 0, sh: [shot(1)] },
  { k: 1, mf: 600, fc: 400, set: 1, g: '0-0', pt: '15-0', tb: 0, s: 1, w: 1, f: 0, sh: [shot(1), shot(2), shot(1)] },
  { k: 2, mf: 1200, fc: 500, set: 1, g: '1-0', pt: '0-40', tb: 0, s: 2, w: 1, f: 0, sh: [shot(2), shot(1), shot(2)] },
  { k: 3, mf: 2000, fc: 200, set: 2, g: '0-0', pt: '0-0', tb: 0, s: 1, w: 2, f: 2, sh: [shot(1)] },
];

test('the point index records what each point decided', () => {
  const index = buildDmoReplayPointIndex(points, { matchOver: true });
  assert.equal(index.length, 4);
  assert.deepEqual(index.map((point) => [point.start, point.end]), [[100, 399], [600, 999], [1200, 1699], [2000, 2199]]);
  assert.deepEqual(index.map((point) => point.outcome), ['ace', 'winner', 'error', 'double-fault']);
  assert.deepEqual(index.map((point) => point.endsGame), [false, true, true, true]);
  assert.deepEqual(index.map((point) => point.endsSet), [false, false, true, true]);
  assert.deepEqual(index.map((point) => point.isBreak), [false, false, true, true]);
  assert.equal(index[3].endsMatch, true);
  assert.equal(buildDmoReplayPointIndex(points)[3].endsMatch, false, 'an unfinished recording ends no match');
  assert.deepEqual(describeDmoReplayPoint(index[1], ['Ana', 'Bea']), { winner: 'Ana', how: 'Winner · 3 shots' });
  assert.deepEqual(describeDmoReplayPoint(index[2], ['Ana', 'Bea']), { winner: 'Ana', how: 'Opponent error · 3 shots' });
  assert.deepEqual(describeDmoReplayPoint(index[3], ['Ana', 'Bea']), { winner: 'Bea', how: 'Double fault' });
  assert.deepEqual(buildDmoReplayPointIndex(null), []);
});

test('finding the current point and stepping between points', () => {
  const index = buildDmoReplayPointIndex(points);
  assert.equal(dmoReplayPointAt(index, 50), -1);
  assert.equal(dmoReplayPointAt(index, 100), 0);
  assert.equal(dmoReplayPointAt(index, 1100), 1, 'between points belongs to the point just played');
  assert.equal(dmoReplayPointAt(index, 9999), 3);
  assert.equal(dmoReplayAdjacentPointFrame(index, 700, 1, 60), 1200);
  assert.equal(dmoReplayAdjacentPointFrame(index, 2100, 1, 60), null, 'no point after the last');
  assert.equal(dmoReplayAdjacentPointFrame(index, 1300, -1, 60), 600, 'just after a point starts, previous goes back one');
  assert.equal(dmoReplayAdjacentPointFrame(index, 1500, -1, 60), 1200, 'later in a point, previous restarts it');
  assert.equal(dmoReplayAdjacentPointFrame(index, 120, -1, 60), 100, 'the first point restarts');
  assert.equal(dmoReplayAdjacentPointFrame(index, 50, -1, 60), null);
});

test('seek-bar marks sit where games and sets end', () => {
  const index = buildDmoReplayPointIndex(points, { matchOver: true });
  assert.deepEqual(dmoReplaySeekMarkers(index, 0, 2400), [
    { fraction: 1200 / 2400, kind: 'game', point: 2 },
    { fraction: 2000 / 2400, kind: 'set', point: 3 },
  ]);
  assert.deepEqual(dmoReplaySeekMarkers(index, 0, 0), []);
});

test('replay speeds step through ¼× to 8×', () => {
  assert.deepEqual([...DMO_REPLAY_SPEEDS], [0.25, 0.5, 1, 2, 4, 8]);
  assert.equal(stepDmoReplaySpeed(1, 1), 2);
  assert.equal(stepDmoReplaySpeed(1, -1), 0.5);
  assert.equal(stepDmoReplaySpeed(0.25, -1), 0.25);
  assert.equal(stepDmoReplaySpeed(8, 1), 8);
  assert.equal(stepDmoReplaySpeed(3, 1), 2, 'an unknown speed steps from 1×');
  assert.equal(normalizeDmoReplaySpeed('0.5'), 0.5);
  assert.equal(normalizeDmoReplaySpeed(3), 1);
});

test('links to a moment', () => {
  assert.deepEqual(parseDmoReplayMoment('?match=23&t=5:12'), { seconds: 312 });
  assert.deepEqual(parseDmoReplayMoment('t=1:05:12'), { seconds: 3912 });
  assert.deepEqual(parseDmoReplayMoment('t=312'), { seconds: 312 });
  assert.deepEqual(parseDmoReplayMoment('t=5m12s'), { seconds: 312 });
  assert.deepEqual(parseDmoReplayMoment('t=90s'), { seconds: 90 });
  assert.deepEqual(parseDmoReplayMoment('point=34&t=1:00'), { point: 34 }, 'a point wins over a time');
  assert.equal(parseDmoReplayMoment('t=soon'), null);
  assert.equal(parseDmoReplayMoment('t=5:99'), null);
  assert.equal(parseDmoReplayMoment('point=0'), null);
  assert.equal(parseDmoReplayMoment(''), null);
  assert.equal(formatDmoReplayMoment(312.9), '5:12');
  assert.equal(formatDmoReplayMoment(3912), '1:05:12');
  const index = buildDmoReplayPointIndex(points);
  assert.equal(dmoReplayMomentFrame({ seconds: 10 }, index, 100, 2199, 60), 700);
  assert.equal(dmoReplayMomentFrame({ seconds: 9999 }, index, 100, 2199, 60), 2199, 'clamped to the end');
  assert.equal(dmoReplayMomentFrame({ point: 3 }, index, 100, 2199, 60), 1200);
  assert.equal(dmoReplayMomentFrame({ point: 40 }, index, 100, 2199, 60), null);
  assert.equal(
    dmoReplayMomentUrl('https://www.wtslforum.com/replays?match=23&point=4', 312, { match: '23' }),
    'https://www.wtslforum.com/replays?match=23&t=5%3A12',
  );
  assert.equal(
    dmoReplayMomentUrl('https://www.wtslforum.com/livestreams/viewer', 65, { broadcast: 'abc' }),
    'https://www.wtslforum.com/livestreams/viewer?broadcast=abc&t=1%3A05',
  );
  assert.deepEqual(parseDmoReplayMoment(new URL('https://x.test/?t=5%3A12').searchParams), { seconds: 312 });
});

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    values,
  };
}

test('viewer settings are remembered, merged and validated', () => {
  const storage = memoryStorage();
  assert.deepEqual(readDmoBroadcastSettings(storage), {});
  assert.equal(saveDmoBroadcastSettings({ cameraReplay: 'aerial', crowdVolume: 0.5 }, storage), true);
  assert.equal(saveDmoBroadcastSettings({ soundEnabled: false, crowdVolume: 2, timeOfDay: 'noon' }, storage), true);
  assert.deepEqual(readDmoBroadcastSettings(storage), { cameraReplay: 'aerial', soundEnabled: false, crowdVolume: 0.5 });
  assert.deepEqual(sanitizeDmoBroadcastSettings({ renderReplay: 'auto', renderLive: 'auto', replaySpeed: 8, cameraLive: 'custom' }),
    { renderLive: 'auto', replaySpeed: 8 }, 'replays have no auto resolution; a custom camera is not a preset');
  storage.values.set(DMO_BROADCAST_SETTINGS_KEY, '{not json');
  assert.deepEqual(readDmoBroadcastSettings(storage), {});
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.deepEqual(readDmoBroadcastSettings(blocked), {});
  assert.equal(saveDmoBroadcastSettings({ soundEnabled: true }, blocked), false);
  assert.equal(saveDmoBroadcastSettings({ soundEnabled: true }, null), false);
});

test('the replay court wires navigation, shortcuts and remembered settings', async () => {
  const court = await readFile(new URL('../components/DmoLiveCourt3D.tsx', import.meta.url), 'utf8');
  assert.match(court, /aria-label="Previous point"/);
  assert.match(court, /aria-label="Next point"/);
  assert.match(court, /DMO_REPLAY_SPEEDS\.map/);
  assert.match(court, /<DmoReplaySeekMarkers markers=\{replayMarkers\} \/>/);
  assert.match(court, /<DmoReplayPointList/);
  assert.match(court, /window\.addEventListener\('keydown', onKeyDown\)/);
  assert.match(court, /input:not\(\[type="range"\]\), select, textarea/, 'shortcuts never fire while typing');
  assert.match(court, /useMemo\(\s*\(\) => dmoReplaySeekMarkers/, 'marks are worked out once per replay');
  // Saved "sound off" must be applied before the autoplay attempt.
  const restore = court.indexOf('const saved = readDmoBroadcastSettings();');
  const autoplay = court.indexOf('// Default-on broadcasts and replays start immediately');
  assert.ok(restore > 0 && restore < autoplay);
  const player = await readFile(new URL('../components/Te4DmoReplayPlayer.tsx', import.meta.url), 'utf8');
  assert.match(player, /buildDmoReplayPointIndex\(viewer\.pts/);
  assert.match(player, /rememberReplaySpeed=\{!broadcastId\}/, "a broadcast keeps the streamer's speed");
  const list = await readFile(new URL('../components/DmoReplayNavigation.tsx', import.meta.url), 'utf8');
  assert.match(list, /export const DmoReplayPointList = memo\(/, 'the list only re-renders when the point changes');
});
