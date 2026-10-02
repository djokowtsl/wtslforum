import assert from 'node:assert/strict';
import test from 'node:test';
import { answerScreenshotStatsQuestion } from '../lib/screenshotStatsQuestions.ts';

const metrics = [
  {
    label: 'Aces',
    sourceLabel: 'Aces',
    valueFormat: 'number',
    direction: 'desc',
  },
  {
    label: 'Double Faults',
    sourceLabel: 'Double Faults',
    valueFormat: 'number',
    direction: 'asc',
  },
  {
    label: '1st Serve %',
    sourceLabel: '1st Serve %',
    valueFormat: 'percent',
    direction: 'desc',
  },
];

const populations = {
  TE4: [
    {
      playerName: 'Ada Court',
      metrics: { Aces: 8.5, 'Double Faults': 2.1, '1st Serve %': 0.68 },
    },
    {
      playerName: 'Bea Racket',
      metrics: { Aces: 10, 'Double Faults': 3.4, '1st Serve %': 0.71 },
    },
  ],
  'TE4_(F)': [
    {
      playerName: 'Cora Match',
      metrics: { Aces: 11, 'Double Faults': 1.3, '1st Serve %': 0.72 },
    },
    {
      playerName: 'Dana Rally',
      metrics: { Aces: 7, 'Double Faults': 2, '1st Serve %': 0.66 },
    },
  ],
};

test('explicit tour and highest raw value use that tour’s published data', () => {
  assert.equal(
    answerScreenshotStatsQuestion(
      'Who has the most aces in WTA?',
      populations,
      metrics,
      'TE4',
    ),
    'highest raw Aces for WTA:\n1. Cora Match — 11',
  );
});

test('best uses the metric’s quality direction', () => {
  assert.equal(
    answerScreenshotStatsQuestion(
      'Who has the best double faults in ATP?',
      populations,
      metrics,
      'TE4',
    ),
    'best Double Faults for ATP:\n1. Ada Court — 2.1',
  );
});

test('lowest asks for the lowest raw value rather than metric quality', () => {
  assert.equal(
    answerScreenshotStatsQuestion(
      'Who has the lowest aces?',
      populations,
      metrics,
      'TE4',
    ),
    'lowest raw Aces for ATP:\n1. Ada Court — 8.5',
  );
});

test('average is calculated from player-level published values', () => {
  assert.equal(
    answerScreenshotStatsQuestion(
      'What is the average first serve percentage?',
      populations,
      metrics,
      'TE4',
    ),
    'Mean of the published player-level 1st Serve % values: 69.5% (ATP).',
  );
});

test('player-specific questions return that player’s value', () => {
  assert.equal(
    answerScreenshotStatsQuestion(
      "What is Ada Court's first serve percentage?",
      populations,
      metrics,
      'TE4',
    ),
    'Ada Court: 68% for 1st Serve % (ATP).',
  );
});

test('two named players can be compared from the same snapshot', () => {
  assert.equal(
    answerScreenshotStatsQuestion(
      'Compare Ada Court and Bea Racket in aces',
      populations,
      metrics,
      'TE4',
    ),
    'Ada Court: 8.5; Bea Racket: 10. Difference: 1.5 (Aces, ATP).',
  );
});

test('unsupported and ambiguous questions fail without inventing an answer', () => {
  assert.equal(
    answerScreenshotStatsQuestion(
      'Who won Wimbledon?',
      populations,
      metrics,
      'TE4',
    ),
    null,
  );
});