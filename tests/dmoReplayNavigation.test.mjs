import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  DMO_REPLAY_SPEEDS,
  buildDmoReplayCloseCalls,
  buildDmoReplayStatistics,
  buildDmoReplayPointIndex,
  describeDmoReplayPoint,
  describeDmoReplayPointCaption,
  dmoCurrentPointPressure,
  dmoReplayAdjacentPointFrame,
  dmoReplayMomentFrame,
  dmoReplayMomentUrl,
  dmoReplayPointAt,
  dmoReplayPointPressure,
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
  // Routine points get no caption at all, before or after.
  assert.equal(describeDmoReplayPointCaption(index[0], 100, ['Ana', 'Bea']), null);
  assert.equal(describeDmoReplayPointCaption(index[0], 399, ['Ana', 'Bea']), null);
  // The set-winning break: shown after the point, for 3 seconds only.
  assert.deepEqual(describeDmoReplayPointCaption(index[2], 1699, ['Ana', 'Bea'], 60), { title: 'Set · Ana', detail: '' });
  assert.equal(describeDmoReplayPointCaption(index[2], 1699 + 181, ['Ana', 'Bea'], 60), null);
  assert.deepEqual(describeDmoReplayPointCaption(index[3], 2199, ['Ana', 'Bea'], 60), { title: 'Match · Bea', detail: '' });
  assert.deepEqual(buildDmoReplayPointIndex(null), []);
});

test('captions only mark pressure points and long rallies, briefly', () => {
  const names = ['Ana', 'Bea'];
  const breakPoint = { ...buildDmoReplayPointIndex(points)[1], breakPointFor: 2, winner: 1, endsGame: false };
  assert.deepEqual(describeDmoReplayPointCaption(breakPoint, 600, names, 60), { title: 'Break point · Bea', detail: '' });
  assert.equal(describeDmoReplayPointCaption(breakPoint, 600 + 181, names, 60), null, 'gone after 3 s');
  assert.deepEqual(describeDmoReplayPointCaption(breakPoint, 999, names, 60), { title: 'Break point saved · Ana', detail: '' });
  const converted = { ...breakPoint, winner: 2 };
  assert.deepEqual(describeDmoReplayPointCaption(converted, 999, names, 60), { title: 'Break · Bea', detail: '' });
  const rally = { ...buildDmoReplayPointIndex(points)[1], shots: 15 };
  assert.deepEqual(describeDmoReplayPointCaption(rally, 1000, names, 60), { title: '15-shot rally · Ana', detail: '' });
  assert.equal(describeDmoReplayPointCaption({ ...rally, shots: 14 }, 1000, names, 60), null);
});

test('score pressure and match statistics come from each recorded point', () => {
  const setAndMatchPoint = {
    s: 1, g: '5-4', pt: '40-15', tb: 0, ss: [[6, 4]],
  };
  assert.deepEqual(dmoReplayPointPressure(setAndMatchPoint, 3), {
    breakPointFor: null,
    setPointFor: 1,
    matchPointFor: 1,
  });
  assert.deepEqual(dmoReplayPointPressure({
    s: 2, g: '6-6', pt: '6-5', tb: 1, ss: [],
  }, 3), {
    breakPointFor: null,
    setPointFor: 1,
    matchPointFor: null,
  });
  assert.deepEqual(dmoCurrentPointPressure({
    server: 2,
    games: [1, 0],
    pointText: ['40', '0'],
    tiebreak: false,
    sets: [],
  }), {
    breakPointFor: 1,
    setPointFor: null,
    matchPointFor: null,
  });
  const stats = buildDmoReplayStatistics(points.map((point, index) =>
    index === 2 ? { ...point, pt: '40-0' } : point));
  assert.deepEqual(
    stats.map(({ pointsWon, servicePoints, servicePointsWon, aces, doubleFaults, winners, errors, breakPointsFaced, breakPointsConverted }) =>
      [pointsWon, servicePoints, servicePointsWon, aces, doubleFaults, winners, errors, breakPointsFaced, breakPointsConverted]),
    [
      [3, 3, 2, 1, 1, 1, 0, 0, 1],
      [1, 1, 0, 0, 0, 0, 1, 1, 0],
    ],
  );
});

test('only a recorded error bounce just outside court lines is a close call', () => {
  const points = [
    // bx runs along the court (baseline at ±1188.5 cm), by across it (singles sideline ±411.5 cm).
    { mf: 100, fc: 240, s: 1, w: 2, f: 0, sh: [{ p: 1, bx: 0, by: 418, bt: 140 }] },
    { mf: 500, fc: 240, s: 1, w: 2, f: 0, sh: [{ p: 1, bx: 0, by: 600, bt: 140 }] },
    { mf: 900, fc: 240, s: 1, w: 1, f: 0, sh: [{ p: 1, bx: 0, by: 418, bt: 140 }] },
    { mf: 1300, fc: 240, s: 1, w: 2, f: 0, sh: [{ p: 1, bx: null, by: null, bt: null }] },
    { mf: 1700, fc: 240, s: 1, w: 2, f: 0, sh: [{ p: 1, bx: 555, by: 0, bt: 140 }] },
    { mf: 2100, fc: 240, s: 1, w: 2, f: 0, sh: [{ p: 1, bx: -1195, by: 100, bt: 140 }] },
  ];
  const calls = buildDmoReplayCloseCalls(points);
  assert.deepEqual(calls[0], {
    point: 0,
    frame: 240,
    startFrame: 150,
    endFrame: 339,
    x: 4.18,
    z: 0,
    distanceMeters: 0.07,
  }, 'just wide of the singles line');
  assert.deepEqual(calls.map((call) => call.point), [0, 5],
    'the doubles alley (point 1) is not close; a ball inside the court (point 4) never is; just long (point 5) is');
  assert.equal(calls[1].distanceMeters, 0.07);
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
  assert.match(court, /aria-label="Replay current point"/);
  assert.match(court, /onClick=\{replayCurrentPoint\}/, 'the toolbar replays the active point from its start');
  assert.match(court, /aria-label="Next point"/);
  assert.match(court, /DMO_REPLAY_SPEEDS\.map/);
  assert.match(court, /<DmoReplaySeekMarkers markers=\{replayMarkers\} \/>/);
  assert.match(court, /<DmoReplayPointList/);
  assert.match(court, /viewport\.scrollIntoView/, 'opening the point panel brings the court into view');
  assert.match(court, /Close call · replay/, 'recorded near-line errors trigger one replay');
  assert.match(court, /replaySpeedLocked/, 'broadcast replays do not change the stream speed');
  assert.match(court, /RALLY SHOT/, 'rally callouts use a factual shot label');
  assert.match(court, /Replay settings/, 'full replay settings are grouped behind a disclosure');
  assert.match(court, /window\.addEventListener\('keydown', onKeyDown\)/);
  assert.match(court, /input:not\(\[type="range"\]\), select, textarea/, 'shortcuts never fire while typing');
  assert.match(court, /useMemo\(\s*\(\) => dmoReplaySeekMarkers/, 'marks are worked out once per replay');
  // Saved "sound off" must be applied before the autoplay attempt.
  const restore = court.indexOf('const saved = readDmoBroadcastSettings();');
  const autoplay = court.indexOf('// Default-on broadcasts and replays start immediately');
  assert.ok(restore > 0 && restore < autoplay);
  const player = await readFile(new URL('../components/Te4DmoReplayPlayer.tsx', import.meta.url), 'utf8');
  assert.match(player, /buildDmoReplayPointIndex\(viewer\.pts/);
  assert.match(player, /buildDmoReplayStatistics/);
  assert.match(player, /buildDmoReplayCloseCalls/);
  assert.match(player, /rememberReplaySpeed=\{!broadcastId\}/, "a broadcast keeps the streamer's speed");
  assert.match(player, /replaySpeedLocked=\{Boolean\(broadcastId\)\}/);
  const scoreBug = await readFile(new URL('../components/DmoReplayScoreBug.tsx', import.meta.url), 'utf8');
  assert.match(scoreBug, /styles\.setScore/, 'set totals appear in the scoreboard rows');
  const reportReplay = await readFile(new URL('../components/CoachingReportReplay.tsx', import.meta.url), 'utf8');
  assert.match(reportReplay, /select-point/, 'approved report highlights jump to their points');
  const reportPage = await readFile(new URL('../app/coaching-hub/[id]/page.tsx', import.meta.url), 'utf8');
  assert.match(reportPage, /<Te4CoachInsights \/>/, 'shared WTSL context is shown beside public match reports');
  const list = await readFile(new URL('../components/DmoReplayNavigation.tsx', import.meta.url), 'utf8');
  assert.match(list, /export const DmoReplayPointList = memo\(/, 'the list only re-renders when the point changes');
});

test('close-call replays review the ball like Hawk-Eye: flight, mark, gap and distance', async () => {
  const court = await readFile(new URL('../components/DmoLiveCourt3D.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(court, /host\.style\.transform = 'scale\(1\.55\)'/, 'no flat digital zoom');
  // The recorded bounce: closeCall.z runs along the court (scene x), closeCall.x across it (scene z).
  assert.match(court, /const bounce = new THREE\.Vector3\(closeCall\.z, 0, closeCall\.x\);/);
  assert.match(court, /new THREE\.TubeGeometry\(curve/, 'the flight is drawn from the last hit');
  assert.match(court, /reviewMark\.visible = landed;/, 'the mark appears when the ball lands');
  assert.match(court, /reviewGap\.visible = landed && review\.showGap;/, 'the gap to the line is shown');
  assert.match(court, /if \(!review\) controls\.update\(\);/, 'the review camera is not clamped by the orbit controls');
  assert.match(court, /camera\.position\.copy\(review\.savedCamera\);/, "the viewer's camera comes back afterwards");
  assert.match(court, /CLOSE_CALL_HOLD_MS\);/, 'the replay holds on the mark');
  assert.match(court, /'Wide' : 'Long'\} · \$\{outBy\}/);
});
