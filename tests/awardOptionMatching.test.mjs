import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { findRenamedAwardOptions } from '../lib/awardOptionMatching.ts';

const awardsSource = await readFile(new URL('../lib/awards.ts', import.meta.url), 'utf8');

test('matches a clear option label edit without relying on shuffled option positions', () => {
  const existing = [
    { id: 10, name: 'Arv vs Ventriloquist' },
    { id: 11, name: 'Squeaky vs Mace' },
  ];
  const imported = [
    'Australian Open R16: Arv def Ventriloquist',
    'Squeaky vs Mace',
  ];

  assert.deepEqual(findRenamedAwardOptions(existing, imported), [
    { id: 10, from: 'Arv vs Ventriloquist', to: 'Australian Open R16: Arv def Ventriloquist', position: 1 },
  ]);
});

test('does not infer a rename for an unrelated new option', () => {
  assert.deepEqual(
    findRenamedAwardOptions([{ id: 10, name: 'Arv vs Ventriloquist' }], ['Tournament of the Year']),
    [],
  );
});

test('keeps existing choices matched and leaves newly added options for insertion', () => {
  assert.deepEqual(
    findRenamedAwardOptions(
      [{ id: 10, name: 'Arv vs Ventriloquist' }],
      ['Arv vs Ventriloquist', 'Wimbledon Final: Player A def Player B'],
    ),
    [],
  );
});

test('does not choose between equally plausible renamed options', () => {
  assert.deepEqual(
    findRenamedAwardOptions(
      [{ id: 10, name: 'Arv vs Ventriloquist' }],
      ['Australian Open R16: Arv def Ventriloquist', 'WTA Final: Arv def Ventriloquist'],
    ),
    [],
  );
});

test('updates a matched option row in place so saved votes remain linked', () => {
  assert.match(awardsSource, /UPDATE award_nominees\s+SET name=\$\{rename\.to\}, position=\$\{rename\.position\}\s+WHERE id=\$\{rename\.id\}/s);
});
