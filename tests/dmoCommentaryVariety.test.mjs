import assert from 'node:assert/strict';
import test from 'node:test';
import * as c from '../lib/dmoCommentary.mjs';
import { normalizeDmoSpeechRequest } from '../lib/dmoCommentarySpeech.mjs';

// Deterministic best-of-three matches built from real scoring rules, so the
// whole booth can be exercised the way a viewer hears it.
const pairings = [['gifu', 'Debuffy'], ['barboza', 'squeaky'], ['TheTinkerman_', 'Ragnar'], ['Kos', 'Mila'],
  ['Djokowtsl', 'Ferro'], ['Lumi', 'Vex'], ['Ortega', 'Sato'], ['Bjorn', 'Rafa_K'], ['Nuno', 'Pike'], ['Ash', 'Tilly']];
function random(seed) {
  let state = seed;
  return () => ((state = Math.imul(state ^ (state >>> 15), 2246822507) + 0x6d2b79f5 | 0) >>> 0) / 2 ** 32;
}
const tennis = (value) => ['0', '15', '30', '40'][value];
const pointText = (a, b, tiebreak) => tiebreak ? `${a}-${b}`
  : a >= 3 && b >= 3 ? (a === b ? '40-40' : a > b ? 'AD-40' : '40-AD') : `${tennis(a)}-${tennis(b)}`;
function simulateMatch(seed) {
  const next = random(seed);
  const points = []; const sets = []; let games = [0, 0]; let server = 1; let number = 0;
  const setsWon = () => [sets.filter(([a, b]) => a > b).length, sets.filter(([a, b]) => b > a).length];
  while (Math.max(...setsWon()) < 2) {
    const tiebreak = games[0] === 6 && games[1] === 6;
    const opener = server; let score = [0, 0]; let played = 0;
    for (;;) {
      const serving = !tiebreak ? server
        : played === 0 ? opener : Math.floor((played - 1) / 2) % 2 === 0 ? 3 - opener : opener;
      const faults = next() < 0.07 ? 2 : next() < 0.35 ? 1 : 0;
      const winner = faults === 2 ? 3 - serving : next() < 0.6 ? serving : 3 - serving;
      const rally = faults === 2 ? 0 : next() < 0.12 ? 0 : next() < 0.15 ? 10 + Math.floor(next() * 14) : 1 + Math.floor(next() * 8);
      points.push({
        number: ++number, winner, server: serving, rallyHits: rally, rallyShotCount: rally, faults, isTiebreak: tiebreak,
        scoreBeforeLabel: `${games[0]}-${games[1]}(${pointText(score[0], score[1], tiebreak)})`,
        setBefore: sets.length + 1, setsWonBefore: setsWon(), setsToWin: 2,
      });
      score[winner - 1] += 1; played += 1;
      const target = tiebreak ? 7 : 4;
      if (Math.max(...score) >= target && Math.abs(score[0] - score[1]) >= 2) {
        games[winner - 1] += 1;
        server = tiebreak ? 3 - opener : 3 - server;
        if ((Math.max(...games) >= 6 && Math.abs(games[0] - games[1]) >= 2) || Math.max(...games) === 7) {
          sets.push([...games]); games = [0, 0];
        }
        break;
      }
    }
  }
  points.forEach((point, index) => {
    const following = points[index + 1];
    if (following) Object.assign(point, { scoreAfterLabel: following.scoreBeforeLabel, setAfter: following.setBefore });
    else Object.assign(point, { matchOver: true, finalSets: sets });
  });
  return points;
}

function listen(names, points) {
  const recent = []; const spoken = [];
  const say = (line) => { if (line) { spoken.push(line); recent.unshift(line); } };
  say(c.buildDmoCommentaryIntroduction({ names, tournament: 'Shanghai Masters', surface: 'Hard', round: 'Final' }));
  say(c.buildDmoCommentaryOpeningReply({ names, recentLines: recent }));
  for (let shots = 10; shots <= 22; shots += 4) say(c.buildDmoRallyCommentary({ names, rallyShotCount: shots, pointNumber: shots, recentLines: recent }));
  for (const raw of points) {
    const point = c.withDmoCommentaryHistory(raw, points);
    const line = c.buildDmoPointCommentary(point, names, recent);
    const ending = c.isDmoGameEnding(point);
    say(line);
    if (line && ending) say(c.buildDmoCommentaryScoreReply({ names, point, recentLines: recent }));
    // As in the hook: no reply after a call that announces break, set or match point.
    if (line && !ending && !c.dmoPressureAfterPoint(point)) {
      say(c.buildDmoCommentaryFollowUp({ names, point, leadLine: line, recentLines: recent }));
    }
  }
  return spoken;
}

const matches = pairings.map((names, index) => ({ names, spoken: listen(names, simulateMatch(1000 + index)) }));

test('every spoken line is grounded, complete and speakable by the server voice', () => {
  for (const { spoken } of matches) {
    for (const line of spoken) {
      assert.doesNotMatch(line, /undefined|NaN|null|\$\{|\[object/, line);
      // Replays record bounces and outcomes, not stroke types.
      assert.doesNotMatch(line, /\b(forehand|backhand|volley|slice|lob|drop shot|smash|\bace\b)/i, line);
      for (const sentence of line.split(/(?<=[.!?])\s+/)) {
        assert.ok(normalizeDmoSpeechRequest({ text: sentence, voice: 'af_heart' }), `not speakable: ${sentence}`);
      }
    }
  }
});

test('a whole match rarely repeats a line, and never more than twice', () => {
  let total = 0; let repeats = 0;
  for (const { spoken } of matches) {
    const heard = new Map();
    for (const line of spoken) {
      const times = (heard.get(line) ?? 0) + 1;
      heard.set(line, times);
      total += 1;
      if (times > 1) repeats += 1;
      assert.ok(times <= 2, `heard ${times} times in one match: ${line}`);
    }
  }
  assert.ok(repeats / total < 0.05, `${Math.round(100 * repeats / total)}% of lines were repeats`);
});

test('different matches do not open with the same words', () => {
  const openings = new Set(matches.map(({ names, spoken }) => spoken.slice(0, 2).join(' ')
    .replaceAll(names[0], 'A').replaceAll(names[1], 'B')));
  assert.ok(openings.size >= 6, `only ${openings.size} different openings in ${matches.length} matches`);
});

test('every match ends with game, set and match and the final score', () => {
  for (const { names, spoken } of matches) {
    const ending = spoken.slice(-2).join(' ');
    assert.match(ending, /match/i);
    assert.match(ending, new RegExp(`${names[0].replace(/_/g, ' ').trim()}|${names[1].replace(/_/g, ' ').trim()}`.replace('TheTinkerman', 'The Tinkerman')));
    assert.match(spoken.at(-1), /(love|one|two|three|four|five|six|seven)-(love|one|two|three|four|five|six|seven)/);
  }
});

test('pressure calls vary across pairings but repeat consistently within a replay', () => {
  const point = {
    number: 5, winner: 2, server: 1, rallyHits: 3,
    scoreBeforeLabel: '1-1(15-30)', scoreAfterLabel: '1-1(15-40)',
  };
  const pressureLines = pairings.map((names) => {
    const line = c.buildDmoPointCommentary(point, names);
    return line.split(/(?<=[.!?])\s+/).at(-1);
  });
  assert.ok(new Set(pressureLines).size > 1, 'pairings should not use the same pressure wording');
  assert.equal(
    c.buildDmoPointCommentary(point, pairings[0]),
    c.buildDmoPointCommentary(point, pairings[0]),
    'the same recorded point stays deterministic',
  );
});

test('the co-commentator varies long-rally replies without inventing a result', () => {
  const replies = Array.from({ length: 12 }, (_, index) => c.buildDmoCommentaryFollowUp({
    names: pairings[0],
    point: { number: index + 1, winner: 1, server: 2, rallyHits: 12, rallyShotCount: 12 },
    leadLine: 'gifu wins the point.',
  }));
  assert.ok(new Set(replies).size > 1);
  for (const reply of replies) {
    assert.match(reply, /gifu|Debuffy/);
    assert.doesNotMatch(reply, /\b(forehand|backhand|volley|ace)\b/i);
  }
});

test('a replay produces the same point call whenever it is watched again', () => {
  const point = {
    number: 43, winner: 1, server: 1, rallyHits: 14,
    scoreBeforeLabel: '3-2(30-30)', scoreAfterLabel: '3-2(40-30)',
  };
  const first = c.buildDmoPointCommentary(point, pairings[0]);
  const second = c.buildDmoPointCommentary(point, pairings[0]);
  assert.equal(first, second);
});
