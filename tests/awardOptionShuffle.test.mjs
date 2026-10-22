import test from 'node:test';
import assert from 'node:assert/strict';
import { getAwardShuffleSetting, shuffleAwardOptions } from '../lib/awardOptionShuffle.ts';

test('imported option shuffle is used unless an admin override exists', () => {
  assert.equal(getAwardShuffleSetting({ shuffle_options: true, shuffle_options_override: null }), true);
  assert.equal(getAwardShuffleSetting({ shuffle_options: false, shuffle_options_override: null }), false);
  assert.equal(getAwardShuffleSetting({ shuffle_options: true, shuffle_options_override: false }), false);
  assert.equal(getAwardShuffleSetting({ shuffle_options: false, shuffle_options_override: true }), true);
  assert.equal(getAwardShuffleSetting({}), false);
});

test('voter option order is stable for a seed and differs for another voter', () => {
  const options = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  const original = [...options];
  const firstOrder = shuffleAwardOptions(options, 'voter-one:category-1');

  assert.deepEqual(shuffleAwardOptions(options, 'voter-one:category-1'), firstOrder);
  assert.notDeepEqual(shuffleAwardOptions(options, 'voter-two:category-1'), firstOrder);
  assert.deepEqual([...firstOrder].sort(), original);
  assert.deepEqual(options, original);
});

test('does not shuffle when no private voter seed is available', () => {
  assert.deepEqual(shuffleAwardOptions(['A', 'B', 'C'], ''), ['A', 'B', 'C']);
});
