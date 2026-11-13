import assert from 'node:assert/strict';
import test from 'node:test';
import { createDmoCommentaryTrackPlayer } from '../lib/dmoCommentaryTrackPlayer.mjs';
import { buildDmoCommentaryScript, estimateDmoSpeechSeconds } from '../lib/dmoCommentaryScript.mjs';

const tick = async (times = 6) => { for (let i = 0; i < times; i += 1) await new Promise((r) => setImmediate(r)); };

function player(cues, { fail = () => false, hold = false } = {}) {
  const played = []; const loads = []; const states = []; const finishers = [];
  const track = createDmoCommentaryTrackPlayer({
    cues, fps: 30, lookAhead: 3,
    loadClip: async (clip) => { loads.push(clip); if (fail(clip)) throw new Error('503'); return `audio:${clip}`; },
    playClip: (audio) => { played.push(audio); return hold ? new Promise((resolve) => finishers.push(resolve)) : Promise.resolve(); },
    onState: (state) => states.push(state),
  });
  return { track, played, loads, states, finishers };
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
  p.track.update(301, true); await tick();
  assert.deepEqual(p.played.slice(2), ['audio:game1']);
});

test('upcoming clips are downloaded ahead of time', async () => {
  const p = player([cue('a', 300, 1), cue('b', 600, 2), cue('c', 900, 3), cue('d', 1200, 4)]);
  p.track.start(0, true); await tick();
  assert.deepEqual(p.loads, ['a', 'b', 'c'], 'the next three are fetched before they are due');
});

test('a call the viewer has moved past is dropped with its reply; game calls get longer', async () => {
  const p = player([
    cue('point', 300, 1), cue('point-reply', 300, 1),
    cue('game', 330, 2, { mustPlay: true }),
  ], { hold: true });
  p.track.start(0, true); await tick();
  p.track.update(300 + 30 * 5, true); await tick(); // five seconds late
  assert.deepEqual(p.played, ['audio:game'], 'the routine call and its reply are skipped, the game call is not');
});

test('commentary waits while paused and resumes with playback', async () => {
  const p = player([cue('a', 300, 1)]);
  p.track.start(0, true); await tick();
  p.track.update(310, false); await tick();
  assert.equal(p.played.length, 0);
  p.track.update(311, true); await tick();
  assert.deepEqual(p.played, ['audio:a']);
});

test('seeking back replays calls from the new position, seeking far ahead skips the backlog', async () => {
  const p = player([cue('a', 300, 1), cue('b', 3000, 2), cue('c', 6000, 3)]);
  p.track.start(0, true); await tick();
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
