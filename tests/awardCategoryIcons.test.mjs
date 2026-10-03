import assert from 'node:assert/strict';
import test from 'node:test';
import { CATEGORY_ICONS } from '../lib/awardIcons.ts';

const seasonCategories = [
  'Fans Favourite Award',
  'Stefan Edberg Sportsmanship Award',
  'Most Improved Player',
  'Newcomer of the Year',
  'Arthur Ashe Humanitarian Award',
  'Farmer of the Year',
  'Comedian/Troll of the Year',
  'Trickiest Player',
  'Best Dressed Player',
  'Coach of the Year',
  'Upset of the Year',
  'Match of the Year',
  'Worst Scheduler',
  'Tournament of the Year',
];

test('current and historical award categories share a defined icon', () => {
  for (const category of seasonCategories) {
    assert.ok(CATEGORY_ICONS[category], 'missing icon for ' + category);
  }
});

test('Farmer of the Year keeps the same corn icon in every award view', () => {
  assert.equal(CATEGORY_ICONS['Farmer of the Year'], '🌽');
});
