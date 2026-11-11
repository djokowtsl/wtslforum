import test from 'node:test';
import assert from 'node:assert/strict';
import { loadLiveCharacterGruntSamples } from '../lib/liveGruntAudio.ts';

test('live grunt playback selects each player’s assigned bank and keeps a generic fallback', async () => {
  const fetched = [];
  const context = {
    decodeAudioData: async (buffer) => new TextDecoder().decode(buffer),
  };
  const fetcher = async (url) => {
    fetched.push(url);
    return new Response(new TextEncoder().encode(url), { status: 200 });
  };

  const [firstPlayer, secondPlayer] = await loadLiveCharacterGruntSamples(
    context,
    false,
    ['Felix Auger-Aliassime', null],
    undefined,
    fetcher,
  );

  assert.ok(firstPlayer.length);
  assert.ok(firstPlayer.every((sample) => sample.includes('/male-aliassime/')));
  assert.ok(secondPlayer.length);
  assert.ok(secondPlayer.every((sample) => sample.includes('/grunts/atp-')));
  assert.ok(fetched.some((url) => url.includes('/male-aliassime/')));
});

test('an explicit no-grunt choice stays silent and does not load the generic fallback', async () => {
  const fetched = [];
  const context = { decodeAudioData: async (buffer) => new TextDecoder().decode(buffer) };
  const fetcher = async (url) => {
    fetched.push(url);
    return new Response(new TextEncoder().encode(url), { status: 200 });
  };
  const [muted, profileDefault] = await loadLiveCharacterGruntSamples(
    context,
    false,
    ['Felix Auger-Aliassime', null],
    [
      { groupId: null, useGenericFallback: false },
      { groupId: null, useGenericFallback: true },
    ],
    fetcher,
  );
  assert.deepEqual(muted, []);
  assert.ok(profileDefault.length);
  assert.ok(fetched.every((url) => !url.includes('/male-aliassime/')));
  assert.ok(fetched.some((url) => url.includes('/grunts/atp-')));
});
