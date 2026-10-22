import test from 'node:test';
import assert from 'node:assert/strict';
import { getAwardVoteProgress, getNextUnansweredRequiredCategoryId } from '../lib/awardVoteProgress.ts';

const categories = [
  { id: 1, is_required: true },
  { id: 2, is_required: true },
  { id: 3, is_required: false },
];

test('submission appears when every required category has a saved vote', () => {
  const progress = getAwardVoteProgress(categories, { 1: true, 2: true, 3: false }, {});
  assert.equal(progress.isSubmitted, true);
  assert.equal(progress.requiredSavedCount, 2);
  assert.equal(progress.optionalSavedCount, 0);
  assert.equal(progress.savedQuestionCount, 2);
  assert.equal(progress.questionCount, 3);
  assert.equal(progress.completionPercentage, 67);
  assert.equal(progress.allQuestionsSaved, false);
});

test('an unsaved edit to a required category removes its saved completion status', () => {
  const progress = getAwardVoteProgress(categories, { 1: true, 2: true }, { 2: true });
  assert.equal(progress.isSubmitted, false);
  assert.equal(progress.requiredSavedCount, 1);
});

test('all-optional ballots only show submitted after at least one vote is saved', () => {
  const optionalCategories = [{ id: 3, is_required: false }, { id: 4, is_required: false }];
  assert.equal(getAwardVoteProgress(optionalCategories, {}, {}).isSubmitted, false);
  const progress = getAwardVoteProgress(optionalCategories, { 3: true }, {});
  assert.equal(progress.isSubmitted, true);
  assert.equal(progress.savedQuestionCount, 1);
  assert.equal(progress.questionCount, 2);
  assert.equal(progress.completionPercentage, 50);
});

test('all questions show complete when every required and optional vote is saved', () => {
  const progress = getAwardVoteProgress(categories, { 1: true, 2: true, 3: true }, {});
  assert.equal(progress.isSubmitted, true);
  assert.equal(progress.allQuestionsSaved, true);
  assert.equal(progress.optionalSavedCount, 1);
});

test('saving a required answer points to the next unanswered required question', () => {
  assert.equal(getNextUnansweredRequiredCategoryId(categories, { 1: true }, {}, 1), 2);
  assert.equal(getNextUnansweredRequiredCategoryId(categories, { 1: true, 2: true }, {}, 1), null);
});

test('saving an optional answer does not trigger a required-question scroll', () => {
  assert.equal(getNextUnansweredRequiredCategoryId(categories, { 3: true }, {}, 3), null);
});
