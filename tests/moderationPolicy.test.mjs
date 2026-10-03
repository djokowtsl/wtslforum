import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractImageUrls, moderateContent, moderateTextAndImages, ModerationUnavailableError } from '../lib/moderation.ts';
import { hasCommunityNoteConsensus, partitionCommunityNotes } from '../lib/communityNotePolicy.ts';
import { spoilerMarkupError } from '../lib/spoilers.ts';

const originalFetch = globalThis.fetch;

async function withScores(scores, action) {
  process.env.OPENAI_API_KEY = 'test-key';
  globalThis.fetch = async (_url, options) => {
    assert.equal(options.method, 'POST');
    assert.equal(JSON.parse(options.body).model, 'omni-moderation-latest');
    return new Response(JSON.stringify({ results: [{ category_scores: scores }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  try { return await action(); }
  finally { globalThis.fetch = originalFetch; }
}

test('routine profanity and ordinary content are not flagged by the narrow NSFW policy', async () => {
  const result = await withScores({ sexual: 0.03, 'sexual/minors': 0, 'violence/graphic': 0.02 }, () =>
    moderateContent({ text: 'A normal tennis discussion with some profanity.' }));
  assert.deepEqual(result, { status: 'approved', reason: null });
});

test('uncertain sexual content waits for moderator review', async () => {
  const result = await withScores({ sexual: 0.45, 'sexual/minors': 0, 'violence/graphic': 0 }, () =>
    moderateContent({ text: 'borderline content' }));
  assert.equal(result.status, 'pending');
});

test('explicit sexual content is blocked by the selected threshold', async () => {
  const result = await withScores({ sexual: 0.97, 'sexual/minors': 0, 'violence/graphic': 0 }, () =>
    moderateContent({ text: 'explicit content' }));
  assert.equal(result.status, 'rejected');
});

test('linked HTTPS images are screened and excess links require review', async () => {
  const text = 'See https://cdn.example/one.jpg and https://cdn.example/two.webp.';
  assert.deepEqual(extractImageUrls(text), ['https://cdn.example/one.jpg', 'https://cdn.example/two.webp']);
  const result = await withScores({ sexual: 0.01, 'sexual/minors': 0, 'violence/graphic': 0 }, () =>
    moderateTextAndImages(`${text} ${Array.from({ length: 4 }, (_, i) => `https://cdn.example/${i}.png`).join(' ')}`));
  assert.equal(result.status, 'pending');
});

test('community note consensus requires five ratings and at least 80% helpful votes', () => {
  assert.equal(hasCommunityNoteConsensus(4, 4), false);
  assert.equal(hasCommunityNoteConsensus(5, 4), true);
  assert.equal(hasCommunityNoteConsensus(5, 3), false);
  assert.equal(hasCommunityNoteConsensus(10, 8), true);
});

test('public readers only receive consensus notes; signed-in readers can review proposed notes', () => {
  const notes = [
    { id: 1, has_consensus: true },
    { id: 2, has_consensus: false },
  ];
  assert.deepEqual(partitionCommunityNotes(notes, false), {
    consensus: [notes[0]],
    proposed: [],
  });
  assert.deepEqual(partitionCommunityNotes(notes, true), {
    consensus: [notes[0]],
    proposed: [notes[1]],
  });
});

test('spoiler markup is paired, nonempty, and confined to one line', () => {
  assert.equal(spoilerMarkupError('The ||final result|| is hidden.'), null);
  assert.match(spoilerMarkupError('The ||final result is hidden.'), /paired/);
  assert.match(spoilerMarkupError('Empty ||  || markers.'), /contain text/);
  assert.match(spoilerMarkupError('||first\nsecond||'), /same line/);
});

test('missing provider key fails closed', async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    await assert.rejects(moderateContent({ text: 'content' }), ModerationUnavailableError);
  } finally {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
});