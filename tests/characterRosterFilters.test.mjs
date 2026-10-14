import assert from 'node:assert/strict';
import test from 'node:test';
import {
  characterFilterOptions,
  filterCharacterNames,
} from '../lib/characterRosterFilters.mjs';

const names = ['Alex', 'Blair', 'Casey', 'No metadata'];
const metadata = [
  {
    character: 'Alex',
    country: 'Spain',
    style: 'Defender',
    acceleration: 'None',
    playing_hand: 'left',
    forehand_type: 'one-handed',
    backhand_type: 'two-handed',
  },
  {
    character: 'Blair',
    country: 'Spain',
    style: 'Power Baseliner',
    acceleration: 'Momentum',
    playing_hand: 'right',
    forehand_type: 'two-handed',
    backhand_type: 'two-handed',
  },
  {
    character: 'Casey',
    country: 'Argentina',
    style: 'Defender',
    acceleration: 'None',
    playing_hand: 'left',
    forehand_type: 'one-handed',
    backhand_type: 'one-handed',
  },
];

const noFilters = {
  acceleration: '',
  style: '',
  playing_hand: '',
  forehand_type: '',
  backhand_type: '',
  country: '',
};

test('character roster filters combine selected traits with AND', () => {
  assert.deepEqual(
    filterCharacterNames(names, metadata, {
      ...noFilters,
      country: 'Spain',
      playing_hand: 'left',
      forehand_type: 'one-handed',
      backhand_type: 'two-handed',
    }),
    ['Alex'],
  );
});

test('character filtering is case-insensitive and leaves the roster intact when cleared', () => {
  assert.deepEqual(
    filterCharacterNames(names, metadata, {
      ...noFilters,
      style: 'defender',
      acceleration: 'none',
    }),
    ['Alex', 'Casey'],
  );
  assert.deepEqual(filterCharacterNames(names, metadata, noFilters), names);
});

test('active filters do not match roster names with missing metadata', () => {
  assert.deepEqual(
    filterCharacterNames(names, metadata, { ...noFilters, country: 'Spain' }),
    ['Alex', 'Blair'],
  );
});

test('trait filter options are unique, sorted, and exclude empty values', () => {
  const options = characterFilterOptions([
    { character: 'A', style: 'Defender' },
    { character: 'B', style: '' },
    { character: 'C', style: 'defender' },
    { character: 'D', style: 'Power Baseliner' },
  ], 'style');

  assert.deepEqual(options, ['Defender', 'Power Baseliner']);
});

test('nationality options include countries with no character in the mod', () => {
  const options = characterFilterOptions([], 'country');

  assert.ok(options.length >= 249);
  assert.ok(options.includes('Afghanistan'));
  assert.ok(options.includes('Japan'));
  assert.ok(options.includes('United States'));
});

test('nationality names match Core API country codes and absent nationalities return no characters', () => {
  assert.deepEqual(
    filterCharacterNames(['Alex'], [{ character: 'Alex', country: 'US' }], {
      ...noFilters,
      country: 'United States',
    }),
    ['Alex'],
  );
  assert.deepEqual(
    filterCharacterNames(['Alex'], [{ character: 'Alex', country: 'US' }], {
      ...noFilters,
      country: 'Japan',
    }),
    [],
  );
});
