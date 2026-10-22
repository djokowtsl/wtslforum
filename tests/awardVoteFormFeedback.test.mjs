import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../components/AwardVoteForm.tsx', import.meta.url), 'utf8');

test('the vote action says that a selection must be explicitly saved', () => {
  assert.match(source, /Choose an option, then press/);
  assert.match(source, /Save my vote/);
  assert.match(source, /Update my vote/);
});

test('the voter sees required and optional question labels and a completion message', () => {
  assert.match(source, /c\.is_required \? 'Required' : 'Optional'/);
  assert.match(source, /Ballot submitted/);
  assert.match(source, /Optional questions can be left blank/);
});
