import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { code } = require('next/dist/build/swc').transformSync(
  readFileSync(new URL('../lib/liveBroadcast.ts', import.meta.url), 'utf8'),
  {
    jsc: { parser: { syntax: 'typescript' }, target: 'es2022' },
    module: { type: 'commonjs' },
  },
);
const module = { exports: {} };
new Function('module', 'exports', code)(module, module.exports);
const {
  parseDiscordMessageUrl,
  parseLiveStreamUrl,
  sameLiveMatch,
  streamLinksInDiscordMessage,
  findMatchingWtslLiveMatch,
  isLikelyOfficialWtslMatch,
  liveMatchPlayers,
} = module.exports;

test('accepts Discord permalinks only from the configured WTSL stream channel', () => {
  assert.deepEqual(
    parseDiscordMessageUrl('https://discord.com/channels/786583939028090881/1293144531855872074/1561378343230906484'),
    {
      guildId: '786583939028090881',
      channelId: '1293144531855872074',
      messageId: '1561378343230906484',
    },
  );
  assert.equal(
    parseDiscordMessageUrl('https://discord.com/channels/786583939028090881/123456789012345678/1561378343230906484'),
    null,
  );
  assert.equal(
    parseDiscordMessageUrl('http://discord.com/channels/786583939028090881/1293144531855872074/1561378343230906484'),
    null,
  );
});

test('normalizes supported YouTube and Twitch links for embedding and rejects other hosts', () => {
  assert.deepEqual(parseLiveStreamUrl('https://youtu.be/dQw4w9WgXcQ'), {
    provider: 'youtube',
    id: 'dQw4w9WgXcQ',
    sourceUrl: 'https://youtu.be/dQw4w9WgXcQ',
  });
  assert.equal(parseLiveStreamUrl('https://www.youtube.com/live/dQw4w9WgXcQ')?.provider, 'youtube');
  assert.deepEqual(parseLiveStreamUrl('https://www.twitch.tv/wtsl_player'), {
    provider: 'twitch',
    id: 'wtsl_player',
    sourceUrl: 'https://www.twitch.tv/wtsl_player',
  });
  assert.equal(parseLiveStreamUrl('https://example.com/video'), null);
  assert.equal(parseLiveStreamUrl('javascript:alert(1)'), null);
});

test('extracts stream links from message text and embeds without duplicating the same stream', () => {
  const streams = streamLinksInDiscordMessage({
    content: 'Live here: https://youtu.be/dQw4w9WgXcQ',
    embeds: [{ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }],
  });
  assert.equal(streams.length, 1);
  assert.equal(streams[0].provider, 'youtube');
  assert.equal(streams[0].id, 'dQw4w9WgXcQ');
  assert.equal(streamLinksInDiscordMessage({ content: 'no stream link' }).length, 0);
});

test('homepage matching requires the same two player names and ignores order and accents', () => {
  assert.equal(sameLiveMatch(['Élodie', 'Player Two'], ['Player Two', 'Elodie']), true);
  assert.equal(sameLiveMatch(['王明', '林青'], ['林青', '王明']), true);
  assert.equal(sameLiveMatch(['Player One', 'Player Two'], ['Player One', 'Different Player']), false);
  assert.equal(sameLiveMatch(['Player One', ''], ['Player One', '']), false);
});

test('automatic broadcasts require one unambiguous match in the WTSL live feed', () => {
  const matches = [
    { name: 'Élodie vs Player Two', bestOf: 3 },
    { name: 'Other One vs Other Two', bestOf: 5 },
  ];
  assert.deepEqual(liveMatchPlayers('Élodie vs Player Two'), ['Élodie', 'Player Two']);
  assert.equal(findMatchingWtslLiveMatch(['Player Two', 'Elodie'], matches), matches[0]);
  assert.equal(findMatchingWtslLiveMatch(['Offline One', 'Offline Two'], matches), null);
  assert.equal(
    findMatchingWtslLiveMatch(['Player Two', 'Elodie'], [...matches, matches[0]]),
    null,
  );
});

test('likely-official labels require one matching TE4 draw fixture and best of 3 or 5', () => {
  const fixtures = [
    { tour: 'TE4', first_name: 'Player One', second_name: 'Player Two' },
    { tour: 'TE4_(F)', first_name: 'Player Three', second_name: 'Player Four' },
  ];
  assert.equal(isLikelyOfficialWtslMatch(['Player Two', 'Player One'], 3, fixtures), true);
  assert.equal(isLikelyOfficialWtslMatch(['Player Four', 'Player Three'], 5, fixtures), true);
  assert.equal(isLikelyOfficialWtslMatch(['Player Two', 'Player One'], 1, fixtures), false);
  assert.equal(isLikelyOfficialWtslMatch(['Player One', 'Player Three'], 3, fixtures), false);
  assert.equal(isLikelyOfficialWtslMatch(['Player Two', 'Player One'], 3, [
    ...fixtures,
    fixtures[0],
  ]), false);
});
