import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import * as c from '../lib/dmoCommentary.mjs';
import {
  buildDmoLivePhrasebook,
  dmoCommentaryWords,
  isDmoCommentaryLineAllowed,
} from '../lib/dmoCommentaryPhrasebook.mjs';
import { buildDmoCommentaryScript } from '../lib/dmoCommentaryScript.mjs';
import { simulateDmoCommentaryMatch } from '../lib/dmoCommentarySimulator.mjs';
import {
  DMO_COMMENTARY_VOCABULARY,
  extractDmoCommentaryVocabulary,
} from '../lib/dmoCommentaryVocabulary.mjs';

const names = ['gifu', 'Debuffy'];
const book = buildDmoLivePhrasebook({ names, tournament: 'Roland-Garros', surface: 'Clay', round: 'Final',
  context: { tour: 'ATP', players: [{ rank: 3 }, { rank: 8 }], headToHead: null } });

test('the vocabulary list matches the commentary wording (run scripts/update-commentary-vocabulary.mjs if not)', () => {
  const source = readFileSync(new URL('../lib/dmoCommentary.mjs', import.meta.url), 'utf8');
  assert.deepEqual([...DMO_COMMENTARY_VOCABULARY], extractDmoCommentaryVocabulary(source));
});

test('the phrasebook leads with the opening and game calls and stays within its size', () => {
  assert.ok(book.lines.length <= 600 && book.lines.length >= 300);
  assert.match(book.lines[0].text, /Roland-Garros|gifu|Debuffy/);
  const firstNonOpening = book.lines.findIndex((line) => !/Roland-Garros|Final/.test(line.text));
  assert.ok(book.lines.slice(firstNonOpening, firstNonOpening + 40).some((line) => /game|match|set/i.test(line.text)),
    'game, set and match calls come early');
  assert.ok(book.lines.some((line) => /rankings/.test(line.text)), 'the pre-match facts are included');
  assert.equal(new Set(book.lines.map((line) => `${line.voice}|${line.text}`)).size, book.lines.length);
});

test('a phrasebook built in advance covers most of what a new match says', () => {
  const key = (cue) => `${cue.voice}|${cue.text}`;
  const known = new Set(book.lines.map(key));
  let hit = 0; let total = 0;
  for (let seed = 0; seed < 10; seed += 1) {
    const script = buildDmoCommentaryScript({ names, points: simulateDmoCommentaryMatch(424_242 + seed),
      tournament: 'Roland-Garros', surface: 'Clay', round: 'Final' });
    for (const cue of script.cues.filter((entry) => entry.kind !== 'join')) {
      total += 1; if (known.has(key(cue))) hit += 1;
    }
  }
  assert.ok(hit / total >= 0.7, `${Math.round(100 * hit / total)}% covered`);
});

test('everything the booth can say passes the vocabulary check, and other text does not', () => {
  const vocabulary = book.vocabulary;
  for (let seed = 0; seed < 5; seed += 1) {
    const points = simulateDmoCommentaryMatch(99 + seed);
    const recent = [];
    for (const point of points) {
      const line = c.buildDmoPointCommentary(c.withDmoCommentaryHistory(point, points), names, recent);
      if (line) { recent.unshift(line); assert.ok(isDmoCommentaryLineAllowed(line, vocabulary), line); }
    }
    for (let shots = 10; shots < 40; shots += 3) {
      const rally = c.buildDmoRallyCommentary({ names, rallyShotCount: shots, pointNumber: seed, recentLines: [] });
      assert.ok(isDmoCommentaryLineAllowed(rally, vocabulary), rally);
    }
  }
  assert.equal(isDmoCommentaryLineAllowed('Send me your password now.', vocabulary), false);
  assert.equal(isDmoCommentaryLineAllowed('Game, gifu. Click this link.', vocabulary), false);
  assert.equal(isDmoCommentaryLineAllowed('<script>', vocabulary), false);
  assert.equal(isDmoCommentaryLineAllowed('27 shots in this point now, and Debuffy wins it.', vocabulary), true);
});

test('words are compared without case or punctuation', () => {
  assert.deepEqual(dmoCommentaryWords("Game, set and match — gifu's!"), ['game', 'set', 'and', 'match', "gifu's"]);
});
