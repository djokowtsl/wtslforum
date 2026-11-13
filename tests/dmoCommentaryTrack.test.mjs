import assert from 'node:assert/strict';
import test from 'node:test';
import { createDmoCommentaryTrackPlayer } from '../lib/dmoCommentaryTrackPlayer.mjs';
import { buildDmoCommentaryScript, estimateDmoSpeechSeconds } from '../lib/dmoCommentaryScript.mjs';

const tick = async (times = 6) => { for (let i = 0; i < times; i += 1) await new Promise((r) => setImmediate(r)); };

function player(cues, { fail = () => false, hold = false, slow = () => false } = {}) {
  const played = []; const loads = []; const states = []; const finishers = []; const waits = [];
  const slowLoads = new Map(); const positions = [];
  const track = createDmoCommentaryTrackPlayer({
    cues, fps: 30, lookAhead: 3,
    wait: (ms) => new Promise((resolve) => waits.push({ ms, resolve })),
    onPosition: (frame) => positions.push(frame),
    loadClip: async (clip) => {
      loads.push(clip);
      if (fail(clip)) throw new Error('503');
      if (slow(clip)) await new Promise((resolve) => slowLoads.set(clip, resolve));
      return `audio:${clip}`;
    },
    playClip: (audio) => { played.push(audio); return hold ? new Promise((resolve) => finishers.push(resolve)) : Promise.resolve(); },
    onState: (state) => states.push(state),
  });
  return { track, played, loads, states, finishers, waits, slowLoads, positions };
}

const cue = (clip, at, group, extra = {}) => ({ clip, at, group, ...extra });

test('the opening plays at once, then each call plays when its frame is reached', async () => {
  const p = player([cue('intro', null, 1), cue('reply', null, 1), cue('game1', 300, 2), cue('game2', 900, 3)]);
  p.track.start(0, true);
  await tick();
  assert.deepEqual(p.played, ['audio:intro', 'audio:reply']);
  assert.deepEqual(p.states, ['starting', 'on']);
  p.track.update(299, true); await tick();
  assert.equal(p.played.length, 2, 'not before its frame');
  p.track.update(300, true); await tick();
  assert.deepEqual(p.played.slice(2), ['audio:game1']);
});

test('upcoming clips are downloaded ahead of time', async () => {
  const p = player([cue('a', 300, 1), cue('b', 600, 2), cue('c', 900, 3), cue('d', 3000, 4)]);
  p.track.start(0, true); await tick();
  assert.deepEqual(p.loads, ['a', 'b', 'c'], 'the next three are fetched before they are due');
});

test('a call the viewer has moved past is dropped with its reply; game calls get longer', async () => {
  const p = player([
    cue('point', 300, 1), cue('point-reply', 300, 1),
    cue('game', 330, 2, { mustPlay: true }),
  ], { hold: true });
  p.track.start(150, true); await tick();
  p.track.update(450, true); await tick(); // the point is five seconds late
  assert.deepEqual(p.played, ['audio:game'], 'the routine call and its reply are skipped, the game call is not');
});

test('commentary waits while paused and resumes with playback', async () => {
  const p = player([cue('a', 300, 1)]);
  p.track.start(0, true); await tick();
  p.track.update(300, false); await tick();
  assert.equal(p.played.length, 0);
  p.track.update(301, true); await tick();
  assert.deepEqual(p.played, ['audio:a']);
});

test('seeking back replays calls from the new position, seeking far ahead skips the backlog', async () => {
  const p = player([cue('a', 300, 1), cue('b', 3000, 2), cue('c', 6000, 3)]);
  p.track.start(0, true); await tick();
  p.track.update(300, true); await tick();
  p.track.update(305, true); await tick();
  p.track.update(5990, true); await tick();
  assert.deepEqual(p.played, ['audio:a'], 'jumping ahead does not play everything in between');
  p.track.update(6005, true); await tick();
  p.track.update(200, true); await tick();
  p.track.update(305, true); await tick();
  assert.deepEqual(p.played, ['audio:a', 'audio:c', 'audio:a']);
});

test('repeated download failures report unavailable instead of silence', async () => {
  const p = player([cue('a', 30, 1), cue('b', 60, 2), cue('c', 90, 3)], { fail: () => true });
  p.track.start(0, true); await tick();
  for (const frame of [31, 61, 91]) { p.track.update(frame, true); await tick(); }
  assert.equal(p.states.at(-1), 'unavailable');
});

test('stopping silences everything still queued', async () => {
  const p = player([cue('a', 30, 1), cue('b', 31, 2)], { hold: true });
  p.track.start(0, true); await tick();
  p.track.update(40, true); await tick();
  p.track.stop();
  p.finishers.forEach((finish) => finish()); await tick();
  assert.deepEqual(p.played, ['audio:a']);
});

// ---- The script ----

function simulatedPoints() {
  const points = []; let frame = 0;
  // Two service games won to 15, then a break.
  const games = [[1, 1, '0-0'], [2, 2, '1-0'], [1, 2, '1-1']];
  let number = 0;
  for (const [winner, server, games0] of games) {
    const labels = winner === server
      ? ['15-0', '30-0', '40-0']
      : (server === 1 ? ['0-15', '0-30', '0-40'] : ['15-0', '30-0', '40-0']);
    const before = ['0-0', ...labels];
    for (let i = 0; i < 4; i += 1) {
      frame += 30 * 12; number += 1;
      const [a, b] = games0.split('-').map(Number);
      const after = i < 3 ? `${games0}(${labels[i]})` : `${winner === 1 ? a + 1 : a}-${winner === 2 ? b + 1 : b}(0-0)`;
      points.push({ number, frame, winner, server, rallyHits: 3, rallyShotCount: 3,
        scoreBeforeLabel: `${games0}(${before[i]})`, scoreAfterLabel: after, setBefore: 1, setAfter: 1 });
    }
  }
  return points;
}

test('the script times every call, never overlaps, and never drops a game ending', () => {
  const points = simulatedPoints();
  const script = buildDmoCommentaryScript({ names: ['gifu', 'Debuffy'], points, fps: 30, surface: 'Clay' });
  const timed = script.cues.filter((cue) => cue.at !== null);
  assert.equal(script.cues.filter((cue) => cue.kind === 'opening').length, 2);
  assert.equal(new Set(timed.filter((cue) => cue.kind === 'game').map((cue) => cue.group)).size, 3, 'all three games are called');
  for (let index = 1; index < timed.length; index += 1) {
    const previous = timed[index - 1];
    const previousEnd = previous.at + estimateDmoSpeechSeconds(previous.text) * 30;
    assert.ok(timed[index].at >= previousEnd, `"${timed[index].text}" starts after "${previous.text}" ends`);
  }
  for (const cue of timed) {
    const point = points.find((candidate) => candidate.frame <= cue.at && cue.at - candidate.frame < 30 * 12);
    assert.ok(point, 'each call follows the point it describes');
  }
  assert.ok(script.cues.every((cue) => cue.voice === (cue.speaker === 'female' ? 'af_heart' : 'am_michael')));
});

test('the same replay always produces the same script', () => {
  const build = () => JSON.stringify(buildDmoCommentaryScript({ names: ['gifu', 'Debuffy'], points: simulatedPoints() }));
  assert.equal(build(), build());
});

test('without verified names there is no script', () => {
  assert.deepEqual(buildDmoCommentaryScript({ names: ['', ''], points: simulatedPoints() }).cues, []);
});

test('a clip that failed is not requested again for five seconds', async () => {
  let time = 0; let requests = 0;
  const track = createDmoCommentaryTrackPlayer({
    cues: [cue('a', 300, 1)], fps: 30, now: () => time,
    loadClip: async () => { requests += 1; throw new Error('503'); },
    playClip: async () => {},
  });
  track.start(0, true); await tick();
  for (let step = 0; step < 8; step += 1) { time += 250; track.update(step, true); await tick(); }
  assert.equal(requests, 1, 'two seconds of updates make no new request');
  time += 5_000; track.update(20, true); await tick();
  assert.equal(requests, 2, 'it is retried after the cool-down');
});

test('if the very first clip cannot be downloaded, it says unavailable at once', async () => {
  const p = player([cue('intro', null, 1), cue('a', 3000, 2)], { fail: () => true });
  p.track.start(0, true); await tick();
  assert.deepEqual(p.states, ['starting', 'unavailable']);
});

test('turning commentary on part-way plays where the match stands, not the opening', async () => {
  const p = player([
    cue('intro', null, 1), cue('reply', null, 1),
    cue('game1', 300, 2, { mustPlay: true }), cue('join1', 300, 3, { kind: 'join' }),
    cue('game2', 900, 4, { mustPlay: true }), cue('join2', 900, 5, { kind: 'join' }),
    cue('point', 1200, 6),
  ]);
  p.track.start(1000, true); await tick();
  assert.deepEqual(p.played, ['audio:join2'], 'the latest score, then nothing already past');
  p.track.update(1205, true); await tick();
  assert.deepEqual(p.played, ['audio:join2', 'audio:point'], 'then calls carry on from here');
});

test('score summaries never play as part of the running commentary', async () => {
  const p = player([cue('game1', 300, 1, { mustPlay: true }), cue('join1', 300, 2, { kind: 'join' })]);
  p.track.start(0, true); await tick();
  p.track.update(150, true); await tick();
  p.track.update(305, true); await tick();
  assert.deepEqual(p.played, ['audio:game1']);
});

test('starting during the first game still plays the opening', async () => {
  const p = player([cue('intro', null, 1), cue('join1', 300, 2, { kind: 'join' })]);
  p.track.start(100, true); await tick();
  assert.deepEqual(p.played, ['audio:intro']);
});

test('seeking more than ten seconds forward or back announces the current score', async () => {
  const p = player([
    cue('intro', null, 1),
    cue('join1', 300, 2, { kind: 'join' }),
    cue('join2', 600, 3, { kind: 'join' }),
  ]);
  p.track.start(0, true); await tick();
  p.track.update(30, true); await tick();
  p.track.update(390, true); await tick(); // 12 seconds forward
  p.track.update(900, true); await tick(); // 17 seconds forward
  p.track.update(520, true); await tick(); // more than 12 seconds back
  assert.deepEqual(p.played, ['audio:intro', 'audio:join1', 'audio:join2', 'audio:join1']);
});

test('the script has a score summary after every game except the last', () => {
  const points = simulatedPoints();
  const built = buildDmoCommentaryScript({ names: ['gifu', 'Debuffy'], points, fps: 30, tournament: 'Roland-Garros' });
  const joins = built.cues.filter((entry) => entry.kind === 'join');
  assert.equal(joins.length, 0, 'no set counts without verified sets');
  const withSets = points.map((point) => ({ ...point, setsWonBefore: [0, 0], setsToWin: 2 }));
  const scored = buildDmoCommentaryScript({ names: ['gifu', 'Debuffy'], points: withSets, fps: 30, tournament: 'Roland-Garros' });
  const summaries = scored.cues.filter((entry) => entry.kind === 'join');
  assert.equal(summaries.length, 3);
  assert.match(summaries[0].text, /gifu leads one game to love in the first set/);
  assert.match(summaries[2].text, /gifu leads two games to one in the first set/);
});

test('a clip still being made never holds up the calls behind it', async () => {
  // The 17:50 case: one slow clip used to block every later call until all
  // of them were too late to say.
  const p = player([cue('slow', 300, 1), cue('next', 420, 2), cue('later', 600, 3)], {
    slow: (clip) => clip === 'slow',
  });
  p.track.start(0, true); await tick();
  p.track.update(300, true); await tick();
  assert.equal(p.played.length, 0, 'waiting for the slow clip');
  const limit = p.waits.at(-1);
  assert.ok(limit.ms <= 4_000, 'waits no longer than the call stays worth saying');
  p.track.update(300 + 30 * 4 + 1, true); await tick();
  limit.resolve(); await tick();
  p.track.update(421, true); await tick();
  assert.deepEqual(p.played, ['audio:next'], 'the next call plays on time');
  assert.notEqual(p.track.state, 'unavailable', 'a slow clip is not a failure');
  p.slowLoads.get('slow')(); await tick();
  p.track.update(601, true); await tick();
  assert.deepEqual(p.played, ['audio:next', 'audio:later']);
});

test('a slow score summary is skipped after a few seconds', async () => {
  const p = player([
    cue('join', 600, 9, { kind: 'join' }),
    cue('call', 1300, 2),
  ], { slow: (clip) => clip === 'join' });
  p.track.start(1200, true); await tick();
  const limit = p.waits.at(-1);
  assert.equal(limit.ms, 6_000);
  limit.resolve(); await tick();
  p.track.update(1301, true); await tick();
  assert.deepEqual(p.played, ['audio:call']);
});

test('starting or seeking asks for the next stretch of clips at once', async () => {
  const cues = [];
  for (let i = 1; i <= 20; i += 1) cues.push(cue(`c${i}`, 30 * 60 * 10 + i * 30 * 10, i));
  const p = player(cues);
  p.track.start(30 * 60 * 10, false); await tick();
  // 90 seconds ahead at 10 seconds apart: nine calls, not just the next three.
  assert.deepEqual(p.loads, ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9']);
  assert.deepEqual(p.positions, [30 * 60 * 10]);
  p.track.update(0, false); await tick();
  assert.deepEqual(p.positions, [30 * 60 * 10, 0], 'a seek reports the new position');
});
