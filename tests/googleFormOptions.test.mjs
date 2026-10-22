import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  googleFormCategorySlug,
  parsePublicGoogleFormOptions,
  validatePublicGoogleFormUrl,
} from '../lib/googleFormOptions.ts';

const awardsSource = readFileSync(new URL('../lib/awards.ts', import.meta.url), 'utf8');
const adminRouteSource = readFileSync(new URL('../app/api/admin/awards/route.ts', import.meta.url), 'utf8');
const requiredMigration = readFileSync(new URL('../migrations/2026-10-22-award-question-required.sql', import.meta.url), 'utf8');
const responseMigration = readFileSync(new URL('../migrations/2026-10-22-award-native-form-responses.sql', import.meta.url), 'utf8');

function choice(value) {
  return [value, null, null, null, 0];
}

function question(id, title, type, options = [], shuffleOptions = false, isRequired = true) {
  return [
    id,
    title,
    null,
    type,
    options.length ? [[id + 100, options.map(choice), isRequired ? 1 : 0, null, null, null, null, null, shuffleOptions ? 1 : 0]] : null,
  ];
}

function pageFor(questions) {
  return `<script>var FB_PUBLIC_LOAD_DATA_ = ${JSON.stringify([null, [null, questions]])};</script>`;
}

test('reads single-choice and dropdown award options without treating blank Other rows as nominees', () => {
  const html = pageFor([
    question(1, 'Fans Favorite Award', 2, ['Debuffy', '', 'Arv', 'arv'], true),
    question(2, 'Best Dressed', 4, ['qoodL', 'Dunlop'], false, false),
    question(3, 'Email address', 0, ['not a choice']),
  ]);

  assert.deepEqual(parsePublicGoogleFormOptions(html), [
    {
      questionId: '1',
      title: 'Fans Favorite Award',
      slug: 'fans-favourite',
      options: ['Debuffy', 'Arv'],
      allowWriteIn: true,
      shuffleOptions: true,
      isRequired: true,
    },
    {
      questionId: '2',
      title: 'Best Dressed',
      slug: 'best-dressed-player',
      options: ['qoodL', 'Dunlop'],
      allowWriteIn: false,
      shuffleOptions: false,
      isRequired: false,
    },
  ]);
});

test('fails rather than guessing when the public form omits its required setting', () => {
  const html = pageFor([[
    1,
    'Unclear requirement',
    null,
    2,
    [[101, ['A', 'B'].map(choice), null, null, null, null, null, null, 0]],
  ]]);

  assert.throws(() => parsePublicGoogleFormOptions(html), /could not read whether.*is required/i);
});

test('the admin preview exposes required and optional question settings before import', () => {
  assert.match(adminRouteSource, /isRequired:\s*question\.isRequired/);
});

test('normalizes category aliases while keeping other category slugs readable', () => {
  assert.equal(googleFormCategorySlug('Fans Favourite Award'), 'fans-favourite');
  assert.equal(googleFormCategorySlug('Comedian/Troll of the Year'), 'comedian-troll-of-the-year');
  assert.equal(googleFormCategorySlug('Stefan Edberg Sportsmanship Award'), 'stefan-edberg-sportsmanship');
  assert.equal(googleFormCategorySlug('Arthur Ashe Humanitarian Award'), 'arthur-ashe-humanitarian');
});

test('imports apply the form write-in setting instead of preserving the database default', () => {
  assert.match(awardsSource, /allow_write_in=EXCLUDED\.allow_write_in/);
  assert.doesNotMatch(awardsSource, /allow_write_in=award_categories\.allow_write_in\s+OR/);
});

test('stores imported required settings while keeping existing categories required by default', () => {
  assert.match(awardsSource, /is_required=EXCLUDED\.is_required/);
  assert.match(requiredMigration, /ADD COLUMN IF NOT EXISTS is_required BOOLEAN NOT NULL DEFAULT TRUE/i);
});

test('stores Google Form item IDs for stable native response mapping', () => {
  assert.match(awardsSource, /form_question_id=COALESCE\(EXCLUDED\.form_question_id, award_categories\.form_question_id\)/);
  assert.match(responseMigration, /ADD COLUMN IF NOT EXISTS form_question_id TEXT/i);
});

test('re-import adds new questions and choices without removing existing nominees', () => {
  const importFunction = awardsSource.match(/export async function importGoogleFormOptions[\s\S]*?\n}\n/)[0];
  assert.match(importFunction, /INSERT INTO award_categories[\s\S]*ON CONFLICT \(cycle_id,slug\)/);
  assert.match(importFunction, /is_required=EXCLUDED\.is_required/);
  assert.match(importFunction, /form_question_id=COALESCE/);
  assert.match(importFunction, /INSERT INTO award_nominees[\s\S]*WHERE NOT EXISTS/);
  assert.doesNotMatch(importFunction, /DELETE FROM/);
});

test('voters can still update their existing vote after a form re-import', () => {
  assert.match(awardsSource, /ON CONFLICT \(category_id,source,voter_key\)\s*DO UPDATE SET nominee_id=EXCLUDED\.nominee_id/s);
});

test('accepts only public Google Form response links', () => {
  assert.equal(validatePublicGoogleFormUrl('https://forms.gle/fXXQrpJfZSF3cqReA').hostname, 'forms.gle');
  assert.equal(
    validatePublicGoogleFormUrl('https://docs.google.com/forms/d/e/abc_123/viewform?usp=sf_link').pathname,
    '/forms/d/e/abc_123/viewform',
  );
  assert.throws(() => validatePublicGoogleFormUrl('https://example.com/forms/1'), /public forms\.gle link/i);
  assert.throws(() => validatePublicGoogleFormUrl('http://forms.gle/fXXQrpJfZSF3cqReA'), /public forms\.gle link/i);
});

test('fails explicitly for inaccessible or unsupported form pages', () => {
  assert.throws(() => parsePublicGoogleFormOptions('<html>Sign in to continue</html>'), /Could not read choices/);
});
