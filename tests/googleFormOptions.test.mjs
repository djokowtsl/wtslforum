import test from 'node:test';
import assert from 'node:assert/strict';
import {
  googleFormCategorySlug,
  parsePublicGoogleFormOptions,
  validatePublicGoogleFormUrl,
} from '../lib/googleFormOptions.ts';

function choice(value) {
  return [value, null, null, null, 0];
}

function question(id, title, type, options = []) {
  return [
    id,
    title,
    null,
    type,
    options.length ? [[id + 100, options.map(choice), 1, null, null]] : null,
  ];
}

function pageFor(questions) {
  return `<script>var FB_PUBLIC_LOAD_DATA_ = ${JSON.stringify([null, [null, questions]])};</script>`;
}

test('reads single-choice and dropdown award options without treating blank Other rows as nominees', () => {
  const html = pageFor([
    question(1, 'Fans Favorite Award', 2, ['Debuffy', '', 'Arv', 'arv']),
    question(2, 'Best Dressed', 4, ['qoodL', 'Dunlop']),
    question(3, 'Email address', 0, ['not a choice']),
  ]);

  assert.deepEqual(parsePublicGoogleFormOptions(html), [
    {
      title: 'Fans Favorite Award',
      slug: 'fans-favourite',
      options: ['Debuffy', 'Arv'],
      allowWriteIn: true,
    },
    {
      title: 'Best Dressed',
      slug: 'best-dressed-player',
      options: ['qoodL', 'Dunlop'],
      allowWriteIn: false,
    },
  ]);
});

test('normalizes category aliases while keeping other category slugs readable', () => {
  assert.equal(googleFormCategorySlug('Fans Favourite Award'), 'fans-favourite');
  assert.equal(googleFormCategorySlug('Comedian/Troll of the Year'), 'comedian-troll-of-the-year');
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
