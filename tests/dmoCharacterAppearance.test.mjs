import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dmoCharacterBodyScale,
  dmoCharacterNameKey,
  getDmoCharacterAppearance,
  getDmoCharacterGruntSetting,
  getDmoCharacterGruntUrls,
} from '../lib/dmoCharacterAppearance.mjs';

test('character profiles match names with TE4 tour and version suffixes', () => {
  const profile = getDmoCharacterAppearance('Felix Auger-Aliassime v2 (ATP)');
  assert.equal(profile?.name, 'Felix Auger-Aliassime');
  assert.equal(profile?.heightCm, 190);
  assert.equal(profile?.weightKg, 88);
  assert.equal(dmoCharacterNameKey('Felix Auger-Aliassime v2 (ATP)'), 'felix auger aliassime');
});

test('initial-and-surname replay labels resolve to canonical character and grunt profiles', () => {
  assert.equal(getDmoCharacterAppearance('R.Federer')?.name, 'Roger Federer');
  assert.equal(getDmoCharacterAppearance('N.Djokovic')?.name, 'Novak Djokovic');
  assert.equal(dmoCharacterNameKey('R.Federer'), 'roger federer');
  assert.equal(dmoCharacterNameKey('N.Djokovic'), 'novak djokovic');
  assert.deepEqual(getDmoCharacterGruntSetting('R.Federer'), {
    groupId: 'male-federer',
    useGenericFallback: false,
  });
  assert.deepEqual(getDmoCharacterGruntSetting('N.Djokovic'), {
    groupId: 'male-djokovic',
    useGenericFallback: false,
  });
});

test('profile grunt banks provide only their assigned character samples', () => {
  const urls = getDmoCharacterGruntUrls('Felix Auger-Aliassime');
  assert.equal(urls.length, 3);
  assert.ok(urls.every((url) => url.startsWith('/audio/xkt/character-grunts/male-aliassime/')));
  assert.deepEqual(getDmoCharacterGruntUrls('Unknown player'), []);
});

test('height and weight change bounded player dimensions', () => {
  const average = dmoCharacterBodyScale(183, 80, false);
  const taller = dmoCharacterBodyScale(200, 80, false);
  const heavier = dmoCharacterBodyScale(183, 100, false);
  assert.equal(average.height, 1);
  assert.ok(taller.height > average.height);
  assert.ok(heavier.width > average.width);
  assert.ok(dmoCharacterBodyScale(250, 200, false).height <= 1.12);
  assert.ok(dmoCharacterBodyScale(120, 25, true).width >= 0.9);
});
