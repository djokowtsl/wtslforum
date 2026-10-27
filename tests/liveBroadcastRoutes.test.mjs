import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function loadRoute(path, mocks) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const { code } = require('next/dist/build/swc').transformSync(source, {
    jsc: { parser: { syntax: 'typescript' }, target: 'es2022' },
    module: { type: 'commonjs' },
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)((name) => {
    if (name in mocks) {
      const mocked = mocks[name];
      if (name === '@/lib/liveBroadcast' && typeof mocked.parseLiveStreamUrl !== 'function') {
        return { ...mocked, parseLiveStreamUrl: () => null };
      }
      return mocked;
    }
    if (name.startsWith('node:')) return require(name);
    if (name === 'zod') return require('zod');
    if (name === '@/lib/liveScores') {
      return {
        getLiveBroadcastScoreFeed: async () => null,
        getLiveWtslMatchForPlayers: async () => null,
        canonicalizeRankedDmoPlayers: async (players) => players,
      };
    }
    if (name === '@/lib/liveBroadcastScore') return { scoreForLiveBroadcast: () => null };
    if (name === '@/lib/liveRequestSecurity') {
      return { isSameSiteMutation: (request) => request.headers.get('origin') === 'https://forum.test' };
    }
    if (name === '@/lib/siteSnapshots') return { readSiteSnapshot: async () => null };
    if (name === '@/lib/liveDmoStorage') {
      return {
        cleanupExpiredLiveDmoBroadcasts: async () => {},
        isLiveDmoReplayPath: (value) => typeof value === 'string' && value.startsWith('dmo-live-replays/'),
      };
    }
    if (name === '@/lib/discord') return { announceLiveBroadcast: async () => {} };
    if (name === '@/lib/liveBroadcastStart') {
      return { startExternalLiveBroadcast: async () => ({ id: 'external-broadcast', duplicate: false }) };
    }
    if (name === '@/lib/liveBroadcastAnnouncements') {
      return { finishLiveBroadcastAnnouncement: async () => {} };
    }
    throw new Error(`Unexpected route dependency: ${name}`);
  }, module, module.exports);
  return module.exports;
}

function loadDiscordAnnouncements() {
  const source = readFileSync(new URL('../lib/discord.ts', import.meta.url), 'utf8');
  const { code } = require('next/dist/build/swc').transformSync(source, {
    jsc: { parser: { syntax: 'typescript' }, target: 'es2022' },
    module: { type: 'commonjs' },
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)((name) => {
    if (name.startsWith('node:')) return require(name);
    throw new Error(`Unexpected Discord module dependency: ${name}`);
  }, module, module.exports);
  return module.exports;
}

function loadAnnouncementLifecycle(discord) {
  const source = readFileSync(new URL('../lib/liveBroadcastAnnouncements.ts', import.meta.url), 'utf8');
  const { code } = require('next/dist/build/swc').transformSync(source, {
    jsc: { parser: { syntax: 'typescript' }, target: 'es2022' },
    module: { type: 'commonjs' },
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)((name) => {
    if (name === 'next/server') return nextServer;
    if (name === '@/lib/discord') return discord;
    throw new Error(`Unexpected announcement lifecycle dependency: ${name}`);
  }, module, module.exports);
  return module.exports;
}

function loadLiveBroadcastStart({ sql, announceLiveBroadcast }) {
  const source = readFileSync(new URL('../lib/liveBroadcastStart.ts', import.meta.url), 'utf8');
  const { code } = require('next/dist/build/swc').transformSync(source, {
    jsc: { parser: { syntax: 'typescript' }, target: 'es2022' },
    module: { type: 'commonjs' },
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)((name) => {
    if (name === 'node:crypto') return { randomUUID: () => 'external-broadcast' };
    if (name === '@/lib/db') return { sql };
    if (name === '@/lib/liveDmoStorage') return { cleanupExpiredLiveDmoBroadcasts: async () => {} };
    if (name === '@/lib/discord') return { announceLiveBroadcast };
    if (name === '@/lib/liveBroadcastAnnouncements') return { finishLiveBroadcastAnnouncement: async () => {} };
    throw new Error(`Unexpected live broadcast start dependency: ${name}`);
  }, module, module.exports);
  return module.exports;
}

function request(body, path = '/api/live-dmo', method = 'POST') {
  return new Request(`https://forum.test${path}`, {
    method,
    headers: {
      Origin: 'https://forum.test',
      'X-Forwarded-Host': 'forum.test',
      'X-Forwarded-Proto': 'https',
      'Content-Type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const backgroundCallbacks = [];
const nextServer = {
  after: (callback) => backgroundCallbacks.push(callback),
  NextResponse: { json: (body, init) => Response.json(body, init) },
};
const liveMessageUrl = 'https://discord.com/channels/786583939028090881/1293144531855872074/1561378343230906484';
const validMessage = {
  id: '1561378343230906484',
  channel_id: '1293144531855872074',
  author: { id: 'linked-member', bot: false },
  content: 'Live stream: https://youtu.be/dQw4w9WgXcQ',
  embeds: [],
};

test('a signed-in member can start multiple broadcasts from their linked Discord stream posts', async () => {
  const inserts = [];
  const announcements = [];
  const route = loadRoute('app/api/live-dmo/route.ts', {
    'next/server': nextServer,
    'next': { NextResponse: nextServer.NextResponse },
    'node:crypto': { randomUUID: () => `broadcast-${inserts.length}` },
    'zod': require('zod'),
    '@/lib/auth': { getSession: async () => ({ discordId: 'linked-member', username: 'Linked Member', isAdmin: false }) },
    '@/lib/liveRequestSecurity': { isSameSiteMutation: () => true },
    '@/lib/discord': {
      announceLiveBroadcast: async (announcement) => {
        announcements.push(announcement);
        return { channelId: '1562898541238554765', messageId: `announcement-${announcements.length}` };
      },
    },
    '@/lib/liveBroadcast': {
      parseDiscordMessageUrl: (value) => value === liveMessageUrl
        ? { guildId: '786583939028090881', channelId: '1293144531855872074', messageId: '1561378343230906484' }
        : null,
      streamLinksInDiscordMessage: (message) => message.content.includes('youtu.be')
        ? [{ provider: 'youtube', id: 'dQw4w9WgXcQ', sourceUrl: 'https://youtu.be/dQw4w9WgXcQ' }]
        : [],
    },
    '@/lib/db': {
      sql: async (strings, ...values) => {
        inserts.push({ query: strings.join('?'), values });
        return [];
      },
    },
  });
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.DISCORD_BOT_TOKEN;
  process.env.DISCORD_BOT_TOKEN = 'test-bot-token';
  globalThis.fetch = async () => Response.json(validMessage);
  try {
    const first = await route.POST(request({ hasDmo: false, discordMessageUrl: liveMessageUrl, players: ['Alpha', 'Beta'] }));
    const second = await route.POST(request({ hasDmo: false, discordMessageUrl: liveMessageUrl, players: ['Alpha', 'Beta'] }));
    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    assert.equal(inserts.filter((item) => item.query.includes('INSERT INTO dmo_live_broadcasts')).length, 2);
    assert.equal(inserts.some((item) => item.query.includes("status='live'")), false);
    assert.equal(announcements.length, 2);
    assert.equal(announcements[0].ownerDiscordId, 'linked-member');
    assert.equal(announcements[0].ownerName, 'Linked Member');
    assert.deepEqual(announcements[0].players, ['Alpha', 'Beta']);
    assert.equal(announcements[0].stream.provider, 'youtube');
    assert.equal(inserts.filter((item) => item.query.includes("jsonb_build_object('discordAnnouncement'")).length, 2);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.DISCORD_BOT_TOKEN;
    else process.env.DISCORD_BOT_TOKEN = originalToken;
  }
});

test('a signed-in Forum member can start a stream directly from a supported URL', async () => {
  const starts = [];
  const stream = {
    provider: 'twitch',
    id: 'wtsl_player',
    sourceUrl: 'https://www.twitch.tv/wtsl_player',
  };
  const route = loadRoute('app/api/live-dmo/route.ts', {
    'next/server': nextServer,
    'node:crypto': { randomUUID: () => 'unused-due-to-external-start' },
    'zod': require('zod'),
    '@/lib/auth': { getSession: async () => ({ discordId: 'verified-member', username: 'Verified Member', isAdmin: false }) },
    '@/lib/liveRequestSecurity': { isSameSiteMutation: () => true },
    '@/lib/liveBroadcast': {
      parseDiscordMessageUrl: () => null,
      parseLiveStreamUrl: (value) => value === stream.sourceUrl ? stream : null,
      streamLinksInDiscordMessage: () => [],
    },
    '@/lib/liveBroadcastStart': {
      startExternalLiveBroadcast: async (input) => {
        starts.push(input);
        return { id: 'external-stream-123', duplicate: false };
      },
    },
    '@/lib/db': { sql: async () => [] },
  });

  const response = await route.POST(request({
    hasDmo: false,
    discordMessageUrl: stream.sourceUrl,
    character: 'Serena Williams',
  }));
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), {
    id: 'external-stream-123',
    stream,
    character: 'Serena Williams',
    isWta: false,
    replay: false,
    replaySpeed: 1,
  });
  assert.equal(starts.length, 1);
  assert.equal(starts[0].ownerDiscordId, 'verified-member');
  assert.equal(starts[0].ownerName, 'Verified Member');
  assert.deepEqual(starts[0].stream, stream);
  assert.equal(starts[0].character, 'Serena Williams');
  assert.equal(starts[0].sourceMessageUrl, undefined);
});

test('broadcast owners can add or remove a character on a live stream', async () => {
  const broadcastId = 'ad407a42-df03-4f70-9a8c-11e755683f74';
  const updates = [];
  const route = loadRoute('app/api/live-dmo/[id]/character/route.ts', {
    'next/server': nextServer,
    'zod': require('zod'),
    '@/lib/auth': { getSession: async () => ({ discordId: 'broadcast-owner', isAdmin: false }) },
    '@/lib/liveRequestSecurity': { isSameSiteMutation: () => true },
    '@/lib/db': {
      sql: async (strings, ...values) => {
        updates.push({ query: strings.join('?'), values });
        return [{ id: broadcastId }];
      },
    },
  });
  const send = (character) => route.PATCH(
    request({ character }, `/api/live-dmo/${broadcastId}/character`, 'PATCH'),
    { params: Promise.resolve({ id: broadcastId }) },
  );

  const added = await send('Serena Williams');
  assert.equal(added.status, 200);
  assert.deepEqual(await added.json(), { ok: true, character: 'Serena Williams' });
  assert.match(updates[0].query, /owner_discord_id/);
  assert.match(updates[0].query, /status='live'/);
  assert.ok(updates[0].values.includes('broadcast-owner'));
  assert.ok(updates[0].values.includes('Serena Williams'));

  const removed = await send(null);
  assert.equal(removed.status, 200);
  assert.deepEqual(await removed.json(), { ok: true, character: null });
  assert.ok(updates[1].values.includes(null));
});

test('automatic Discord stream intake requires the shared secret and a verified Forum account', async () => {
  const messageId = '1561378343230906484';
  const message = {
    id: messageId,
    channel_id: '1293144531855872074',
    author: { id: '1564000000000000001', bot: false },
    content: 'Live: https://youtu.be/dQw4w9WgXcQ',
    embeds: [],
  };
  const stream = {
    provider: 'youtube',
    id: 'dQw4w9WgXcQ',
    sourceUrl: 'https://youtu.be/dQw4w9WgXcQ',
  };
  const starts = [];
  let memberRows = [{ display_name: 'Verified Forum Member' }];
  const route = loadRoute('app/api/live-dmo/auto-start/route.ts', {
    'next/server': nextServer,
    'zod': require('zod'),
    '@/lib/db': { sql: async () => memberRows },
    '@/lib/liveBroadcast': {
      LIVE_STREAM_CHANNEL_ID: '1293144531855872074',
      LIVE_STREAM_GUILD_ID: '786583939028090881',
      streamLinksInDiscordMessage: () => [stream],
    },
    '@/lib/liveBroadcastStart': {
      startExternalLiveBroadcast: async (input) => {
        starts.push(input);
        return { id: 'discord-stream-123', duplicate: false };
      },
    },
  });
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.DISCORD_BOT_TOKEN;
  const originalSecret = process.env.WTSL_SYNC_SECRET;
  process.env.DISCORD_BOT_TOKEN = 'test-bot-token';
  process.env.WTSL_SYNC_SECRET = 'test-sync-secret';
  globalThis.fetch = async () => Response.json(message);
  const internalRequest = (secret) => new Request('https://forum.test/api/live-dmo/auto-start', {
    method: 'POST',
    headers: {
      ...(secret ? { 'x-wtsl-sync-secret': secret } : {}),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ messageId }),
  });

  try {
    const unauthorized = await route.POST(internalRequest(''));
    assert.equal(unauthorized.status, 401);
    assert.equal(starts.length, 0);

    const accepted = await route.POST(internalRequest('test-sync-secret'));
    assert.equal(accepted.status, 201);
    assert.deepEqual(await accepted.json(), { id: 'discord-stream-123', duplicate: false });
    assert.equal(starts.length, 1);
    assert.equal(starts[0].ownerDiscordId, '1564000000000000001');
    assert.equal(starts[0].ownerName, 'Verified Forum Member');
    assert.equal(
      starts[0].sourceMessageUrl,
      `https://discord.com/channels/786583939028090881/1293144531855872074/${messageId}`,
    );

    memberRows = [];
    const unverified = await route.POST(internalRequest('test-sync-secret'));
    assert.equal(unverified.status, 403);
    assert.equal(starts.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.DISCORD_BOT_TOKEN;
    else process.env.DISCORD_BOT_TOKEN = originalToken;
    if (originalSecret === undefined) delete process.env.WTSL_SYNC_SECRET;
    else process.env.WTSL_SYNC_SECRET = originalSecret;
  }
});

test('Discord announcement delivery failures do not prevent a broadcast from starting', async () => {
  const route = loadRoute('app/api/live-dmo/route.ts', {
    'next/server': nextServer,
    'node:crypto': { randomUUID: () => 'broadcast-after-discord-failure' },
    'zod': require('zod'),
    '@/lib/auth': { getSession: async () => ({ discordId: 'linked-member', username: 'Linked Member', isAdmin: false }) },
    '@/lib/liveRequestSecurity': { isSameSiteMutation: () => true },
    '@/lib/discord': { announceLiveBroadcast: async () => { throw new Error('Discord unavailable'); } },
    '@/lib/liveScores': {
      getLiveWtslMatchForPlayers: async () => ({ bestOf: 3, canonicalPlayers: ['Alpha', 'Beta'], tourHint: 'TE4' }),
    },
    '@/lib/liveBroadcast': {
      parseDiscordMessageUrl: () => null,
      streamLinksInDiscordMessage: () => [],
    },
    '@/lib/db': { sql: async () => [] },
  });
  const originalToken = process.env.DISCORD_BOT_TOKEN;
  delete process.env.DISCORD_BOT_TOKEN;
  try {
    const response = await route.POST(request({
      hasDmo: true,
      players: ['Alpha', 'Beta'],
      mode: 'auto',
      bestOf: 3,
    }));
    assert.equal(response.status, 201);
  } finally {
    if (originalToken === undefined) delete process.env.DISCORD_BOT_TOKEN;
    else process.env.DISCORD_BOT_TOKEN = originalToken;
  }
});

test('external stream announcements ping viewers in the source channel but not the broadcast channel', async () => {
  const { announceLiveBroadcast } = loadDiscordAnnouncements();
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.DISCORD_BOT_TOKEN;
  process.env.DISCORD_BOT_TOKEN = 'test-bot-token';
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('/messages?limit=100')) return Response.json([]);
    return Response.json({ id: `message-${calls.length}` });
  };
  try {
    const reference = await announceLiveBroadcast({
      id: 'external-broadcast',
      ownerDiscordId: 'verified-member',
      ownerName: 'Verified Member',
      players: null,
      bestOf: 3,
      isWta: false,
      officialByBroadcaster: false,
      likelyOfficial: false,
      stream: { provider: 'youtube', sourceUrl: 'https://youtu.be/dQw4w9WgXcQ' },
    }, { pingViewerRoleInSource: true });

    assert.deepEqual(reference, { channelId: '1562898541238554765', messageId: 'message-3' });
    assert.match(calls[1].url, /channels\/1293144531855872074\/messages$/);
    const rolePing = JSON.parse(calls[1].options.body);
    assert.match(rolePing.content, /<@&1439615663860879501>/);
    assert.deepEqual(rolePing.allowed_mentions, { parse: [], users: [], roles: ['1439615663860879501'] });

    assert.match(calls[2].url, /channels\/1562898541238554765\/messages$/);
    const announcement = JSON.parse(calls[2].options.body);
    assert.equal(announcement.content, '<@verified-member> is streaming now');
    assert.deepEqual(announcement.allowed_mentions, { parse: [], users: ['verified-member'], roles: [] });
    assert.equal(announcement.embeds[0].title, '📺 Watch: Verified Member is live');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.DISCORD_BOT_TOKEN;
    else process.env.DISCORD_BOT_TOKEN = originalToken;
  }
});

test('external official broadcasts route the viewer role to the player-facing announcement', async () => {
  const startCalls = [];
  const { startExternalLiveBroadcast } = loadLiveBroadcastStart({
    sql: async (strings) => strings.join('').includes('WITH broadcast_lock')
      ? [{ id: 'external-broadcast', duplicate: false }]
      : [],
    announceLiveBroadcast: async (announcement, options) => {
      startCalls.push({ announcement, options });
      return null;
    },
  });

  await startExternalLiveBroadcast({
    ownerDiscordId: 'broadcaster-123',
    ownerName: 'Broadcaster',
    stream: { provider: 'youtube', id: 'stream-123', sourceUrl: 'https://youtu.be/stream-123' },
    officialByBroadcaster: true,
  });

  assert.equal(startCalls.length, 1);
  assert.equal(startCalls[0].announcement.officialByBroadcaster, true);
  assert.deepEqual(startCalls[0].options, { pingViewerRoleInSource: false });
});

test('official live broadcasts mention the broadcaster and role unless the role was pinged in the past minute', async () => {
  const { announceLiveBroadcast } = loadDiscordAnnouncements();
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.DISCORD_BOT_TOKEN;
  process.env.DISCORD_BOT_TOKEN = 'test-bot-token';
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return calls.length === 1 ? Response.json([]) : Response.json({ id: 'announcement-message' });
  };
  try {
    await announceLiveBroadcast({
      id: 'broadcast-123',
      ownerDiscordId: 'broadcaster-456',
      ownerName: 'Broadcaster',
      players: ['Alpha', 'Beta'],
      bestOf: 3,
      isWta: false,
      officialByBroadcaster: false,
      likelyOfficial: true,
      stream: { provider: 'youtube', sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
    });
    assert.match(calls[0].url, /channels\/1293144531855872074\/messages\?limit=100$/);
    assert.match(calls[1].url, /channels\/1562898541238554765\/messages$/);
    const sent = JSON.parse(calls[1].options.body);
    assert.match(sent.content, /<@broadcaster-456>/);
    assert.match(sent.content, /<@&1439615663860879501>/);
    assert.deepEqual(sent.allowed_mentions, {
      parse: [],
      users: ['broadcaster-456'],
      roles: ['1439615663860879501'],
    });
    assert.equal(sent.embeds[0].title, '📺 Watch: Alpha vs Beta');
    assert.match(sent.embeds[0].url, /\/livestreams\?broadcast=broadcast-123#broadcast-broadcast-123$/);
    assert.match(sent.embeds[0].fields.find((field) => field.name === 'Stream').value, /Watch on YouTube/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.DISCORD_BOT_TOKEN;
    else process.env.DISCORD_BOT_TOKEN = originalToken;
  }
});

test('a broadcaster-tagged official match mentions the viewer role in WTSL Live Streams', async () => {
  const { announceLiveBroadcast } = loadDiscordAnnouncements();
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.DISCORD_BOT_TOKEN;
  process.env.DISCORD_BOT_TOKEN = 'test-bot-token';
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('/messages?limit=100')) return Response.json([]);
    return Response.json({ id: `message-${calls.length}` });
  };
  try {
    await announceLiveBroadcast({
      id: 'official-broadcast',
      ownerDiscordId: 'broadcaster-456',
      ownerName: 'Broadcaster',
      players: ['Alpha', 'Beta'],
      bestOf: 3,
      isWta: false,
      officialByBroadcaster: true,
      likelyOfficial: false,
      stream: null,
    });

    assert.equal(calls.length, 2);
    assert.match(calls[1].url, /channels\/1562898541238554765\/messages$/);
    const announcement = JSON.parse(calls[1].options.body);
    assert.match(announcement.content, /<@&1439615663860879501>/);
    assert.deepEqual(announcement.allowed_mentions.roles, ['1439615663860879501']);
    assert.equal(
      announcement.embeds[0].fields.find((field) => field.name === 'Match status').value,
      'Official match',
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.DISCORD_BOT_TOKEN;
    else process.env.DISCORD_BOT_TOKEN = originalToken;
  }
});

test('automatic WTSL broadcasts mention the viewer role even without a manual official tag', async () => {
  const { announceLiveBroadcast } = loadDiscordAnnouncements();
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.DISCORD_BOT_TOKEN;
  process.env.DISCORD_BOT_TOKEN = 'test-bot-token';
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('/messages?limit=100')) return Response.json([]);
    return Response.json({ id: `message-${calls.length}` });
  };
  try {
    await announceLiveBroadcast({
      id: 'automatic-official-broadcast',
      ownerDiscordId: 'broadcaster-456',
      ownerName: 'Broadcaster',
      players: ['Alpha', 'Beta'],
      bestOf: 3,
      broadcastMode: 'auto',
      isWta: false,
      officialByBroadcaster: false,
      likelyOfficial: false,
      stream: null,
    });

    assert.equal(calls.length, 2);
    assert.match(calls[1].url, /channels\/1562898541238554765\/messages$/);
    const announcement = JSON.parse(calls[1].options.body);
    assert.match(announcement.content, /<@&1439615663860879501>/);
    assert.deepEqual(announcement.allowed_mentions.roles, ['1439615663860879501']);
    assert.equal(
      announcement.embeds[0].fields.find((field) => field.name === 'Match status').value,
      'Official match',
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.DISCORD_BOT_TOKEN;
    else process.env.DISCORD_BOT_TOKEN = originalToken;
  }
});

test('a recent role ping suppresses only the role mention, while an unclassified stream skips the history lookup', async () => {
  const { announceLiveBroadcast } = loadDiscordAnnouncements();
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.DISCORD_BOT_TOKEN;
  process.env.DISCORD_BOT_TOKEN = 'test-bot-token';
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    if (calls.length === 1) {
      return Response.json([{
        timestamp: new Date(Date.now() - 30_000).toISOString(),
        mention_roles: ['1439615663860879501'],
        content: '',
      }]);
    }
    return Response.json({ id: 'announcement-message' });
  };
  try {
    const officialInput = {
      id: 'broadcast-123',
      ownerDiscordId: 'broadcaster-456',
      ownerName: 'Broadcaster',
      players: ['Alpha', 'Beta'],
      bestOf: 3,
      isWta: false,
      officialByBroadcaster: true,
      likelyOfficial: false,
      stream: null,
    };
    await announceLiveBroadcast(officialInput);
    const officialMessage = JSON.parse(calls[1].options.body);
    assert.match(officialMessage.content, /<@broadcaster-456>/);
    assert.doesNotMatch(officialMessage.content, /<@&1439615663860879501>/);
    assert.deepEqual(officialMessage.allowed_mentions.roles, []);

    calls.length = 0;
    await announceLiveBroadcast({ ...officialInput, officialByBroadcaster: false, likelyOfficial: false });
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /channels\/1562898541238554765\/messages$/);
    const nonOfficialMessage = JSON.parse(calls[0].options.body);
    assert.deepEqual(nonOfficialMessage.allowed_mentions.roles, []);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.DISCORD_BOT_TOKEN;
    else process.env.DISCORD_BOT_TOKEN = originalToken;
  }
});

test('automatic broadcasts require a confirmed WTSL live match and retain its official labels', async () => {
  const inserts = [];
  const announcements = [];
  const route = loadRoute('app/api/live-dmo/route.ts', {
    'next/server': nextServer,
    'node:crypto': { randomUUID: () => 'automatic-broadcast' },
    'zod': require('zod'),
    '@/lib/auth': { getSession: async () => ({ discordId: 'linked-member', isAdmin: false }) },
    '@/lib/liveRequestSecurity': { isSameSiteMutation: () => true },
    '@/lib/discord': { announceLiveBroadcast: async (announcement) => announcements.push(announcement) },
    '@/lib/liveScores': {
      getLiveWtslMatchForPlayers: async (players) => (
        players[0] === 'Alpha' && players[1] === 'Beta'
          ? { name: 'Alpha vs Beta', bestOf: 3, tourHint: 'TE4_(F)' }
          : null
      ),
    },
    '@/lib/siteSnapshots': {
      readSiteSnapshot: async () => ({
        checkedAt: new Date().toISOString(),
        payload: { publicOpen: [{ tour: 'TE4', first_name: 'Beta', second_name: 'Alpha' }] },
      }),
    },
    '@/lib/liveBroadcast': {
      isLikelyOfficialWtslMatch: () => true,
      parseDiscordMessageUrl: () => null,
      streamLinksInDiscordMessage: () => [],
    },
    '@/lib/db': {
      sql: async (strings, ...values) => {
        inserts.push({ query: strings.join('?'), values });
        return [];
      },
    },
  });
  const response = await route.POST(request({
    hasDmo: true,
    players: ['Alpha', 'Beta'],
    mode: 'auto',
    bestOf: 3,
    officialByBroadcaster: true,
  }));
  assert.equal(response.status, 201);
  const insertedBroadcast = inserts.find((item) => item.query.includes('INSERT INTO dmo_live_broadcasts'));
  const storedPayload = insertedBroadcast?.values.find((value) => typeof value === 'string' && value.includes('"mode":"auto"'));
  assert.ok(storedPayload);
  assert.equal(JSON.parse(storedPayload).bestOf, 3);
  assert.equal(JSON.parse(storedPayload).hasDmo, true);
  assert.equal(JSON.parse(storedPayload).officialByBroadcaster, true);
  assert.equal(JSON.parse(storedPayload).likelyOfficial, true);
  assert.equal(JSON.parse(storedPayload).isWta, true);
  assert.equal(announcements.length, 1);
  assert.equal(announcements[0].broadcastMode, 'auto');
  assert.equal(announcements[0].officialByBroadcaster, true);
  assert.equal(announcements[0].likelyOfficial, true);
  assert.equal(announcements[0].isWta, true);
});

test('automatic broadcasts are rejected when the exact player pair is not live', async () => {
  let databaseCalls = 0;
  const route = loadRoute('app/api/live-dmo/route.ts', {
    'next/server': nextServer,
    'node:crypto': require('node:crypto'),
    'zod': require('zod'),
    '@/lib/auth': { getSession: async () => ({ discordId: 'linked-member', isAdmin: false }) },
    '@/lib/liveRequestSecurity': { isSameSiteMutation: () => true },
    '@/lib/liveScores': { getLiveWtslMatchForPlayers: async () => null },
    '@/lib/liveBroadcast': { parseDiscordMessageUrl: () => null, streamLinksInDiscordMessage: () => [] },
    '@/lib/db': { sql: async () => { databaseCalls += 1; return []; } },
  });
  const response = await route.POST(request({
    hasDmo: true,
    players: ['Offline One', 'Offline Two'],
    mode: 'auto',
    bestOf: 3,
  }));
  assert.equal(response.status, 409);
  assert.equal(databaseCalls, 0);
});

test('manual DMO replay stores ranked player names without requiring a current live match', async () => {
  const inserts = [];
  let liveFeedLookups = 0;
  const route = loadRoute('app/api/live-dmo/route.ts', {
    'next/server': nextServer,
    'node:crypto': { randomUUID: () => 'historical-replay' },
    'zod': require('zod'),
    '@/lib/auth': { getSession: async () => ({ discordId: 'linked-member', isAdmin: false }) },
    '@/lib/liveRequestSecurity': { isSameSiteMutation: () => true },
    '@/lib/liveScores': {
      getLiveWtslMatchForPlayers: async () => {
        liveFeedLookups += 1;
        return null;
      },
      canonicalizeRankedDmoPlayers: async () => ['Squeaky', 'Player Two'],
    },
    '@/lib/siteSnapshots': {
      readSiteSnapshot: async () => ({
        checkedAt: new Date().toISOString(),
        payload: { publicOpen: [{ tour: 'TE4', first_name: 'Player Two', second_name: 'Squeaky' }] },
      }),
    },
    '@/lib/liveBroadcast': {
      isLikelyOfficialWtslMatch: (players) => players[0] === 'Squeaky',
      parseDiscordMessageUrl: () => null,
      streamLinksInDiscordMessage: () => [],
    },
    '@/lib/db': {
      sql: async (strings, ...values) => {
        inserts.push({ query: strings.join('?'), values });
        return [];
      },
    },
  });
  const response = await route.POST(request({
    hasDmo: true,
    replay: true,
    replaySpeed: 2,
    players: ['[Fake] Squeaky', 'Player Two'],
    mode: 'manual',
    bestOf: 3,
  }));
  const body = await response.json();
  assert.equal(response.status, 201);
  assert.deepEqual(body.players, ['Squeaky', 'Player Two']);
  assert.equal(body.replay, true);
  assert.equal(body.replaySpeed, 2);
  assert.equal(liveFeedLookups, 0);
  const insertedBroadcast = inserts.find((item) => item.query.includes('INSERT INTO dmo_live_broadcasts'));
  const storedPayload = insertedBroadcast?.values.find((value) => typeof value === 'string' && value.includes('"mode":"manual"'));
  assert.ok(storedPayload);
  assert.deepEqual(JSON.parse(storedPayload).players, ['Squeaky', 'Player Two']);
  assert.equal(JSON.parse(storedPayload).replay, true);
  assert.equal(JSON.parse(storedPayload).replaySpeed, 2);
  assert.equal(JSON.parse(storedPayload).likelyOfficial, true);
});

test('a replay cannot be started without a DMO and parsed player names', async () => {
  let databaseCalls = 0;
  const route = loadRoute('app/api/live-dmo/route.ts', {
    'next/server': nextServer,
    'node:crypto': require('node:crypto'),
    'zod': require('zod'),
    '@/lib/auth': { getSession: async () => ({ discordId: 'linked-member', isAdmin: false }) },
    '@/lib/liveRequestSecurity': { isSameSiteMutation: () => true },
    '@/lib/liveBroadcast': {
      isLikelyOfficialWtslMatch: () => false,
      parseDiscordMessageUrl: () => null,
      streamLinksInDiscordMessage: () => [],
    },
    '@/lib/db': { sql: async () => { databaseCalls += 1; return []; } },
  });
  const response = await route.POST(request({
    hasDmo: false,
    replay: true,
    mode: 'manual',
  }));
  assert.equal(response.status, 400);
  assert.equal(databaseCalls, 0);

  const manualDmoResponse = await route.POST(request({
    hasDmo: true,
    replay: false,
    mode: 'manual',
    players: ['Squeaky', 'Player Two'],
  }));
  assert.equal(manualDmoResponse.status, 400);
  assert.equal(databaseCalls, 0);
});

test('guest broadcast attempts are rejected before database access', async () => {
  let databaseCalls = 0;
  const route = loadRoute('app/api/live-dmo/route.ts', {
    'next/server': nextServer,
    'node:crypto': require('node:crypto'),
    'zod': require('zod'),
    '@/lib/auth': { getSession: async () => null },
    '@/lib/liveRequestSecurity': { isSameSiteMutation: () => true },
    '@/lib/liveBroadcast': { parseDiscordMessageUrl: () => null, streamLinksInDiscordMessage: () => [] },
    '@/lib/db': { sql: async () => { databaseCalls += 1; return []; } },
  });
  const response = await route.POST(request({ hasDmo: true }));
  assert.equal(response.status, 401);
  assert.equal(databaseCalls, 0);
});

test('a Discord message from a different linked account cannot be broadcast', async () => {
  let inserts = 0;
  const route = loadRoute('app/api/live-dmo/route.ts', {
    'next/server': nextServer,
    'node:crypto': require('node:crypto'),
    'zod': require('zod'),
    '@/lib/auth': { getSession: async () => ({ discordId: 'another-member', isAdmin: false }) },
    '@/lib/liveRequestSecurity': { isSameSiteMutation: () => true },
    '@/lib/liveBroadcast': {
      parseDiscordMessageUrl: () => ({ guildId: '786583939028090881', channelId: '1293144531855872074', messageId: validMessage.id }),
      streamLinksInDiscordMessage: () => [{ provider: 'youtube', id: 'dQw4w9WgXcQ', sourceUrl: 'https://youtu.be/dQw4w9WgXcQ' }],
    },
    '@/lib/db': { sql: async () => { inserts += 1; return []; } },
  });
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.DISCORD_BOT_TOKEN;
  process.env.DISCORD_BOT_TOKEN = 'test-bot-token';
  globalThis.fetch = async () => Response.json(validMessage);
  try {
    const response = await route.POST(request({ hasDmo: false, discordMessageUrl: liveMessageUrl }));
    assert.equal(response.status, 403);
    assert.equal(inserts, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.DISCORD_BOT_TOKEN;
    else process.env.DISCORD_BOT_TOKEN = originalToken;
  }
});

test('broadcast owners can heartbeat and end only their own active broadcast', async () => {
  const id = '7e09e922-44c3-49d7-8211-48f13b8b865a';
  const queries = [];
  const route = loadRoute('app/api/live-dmo/[id]/route.ts', {
    'next/server': nextServer,
    'zod': require('zod'),
    '@/lib/auth': { getSession: async () => ({ discordId: 'broadcast-owner', isAdmin: false }) },
    '@/lib/liveRequestSecurity': { isSameSiteMutation: () => true },
    '@/lib/db': {
      sql: async (strings, ...values) => {
        queries.push({ text: strings.join('?'), values });
        return [{ id }];
      },
    },
  });
  const context = { params: Promise.resolve({ id }) };
  const heartbeat = await route.PATCH(request({ sequence: 1 }, `/api/live-dmo/${id}`, 'PATCH'), context);
  assert.equal(heartbeat.status, 200);
  assert.match(queries[0].text, /owner_discord_id=\?/);
  assert.match(queries[0].text, /sequence < \?/);

  const zeroStats = {
    servicePoints: 0,
    servicePointsWon: 0,
    serviceWinRate: null,
    pointsWon: 0,
    firstServeFaults: 0,
    acesOrUnreturned: 0,
  };
  const snapshot = {
    version: 1,
    filename: 'match.dmo',
    stadium: null,
    players: ['One', 'Two'],
    frameCount: 10,
    courtFrameCount: 10,
    pointCount: 1,
    bestOf: 3,
    score: {
      sets: [],
      games: [0, 0],
      points: [0, 0],
      pointText: ['0', '0'],
      tiebreak: false,
      server: null,
    },
    currentPoint: {
      number: 2,
      server: null,
      rallyHits: 1,
      serveSpeedKmh: null,
      inProgress: true,
    },
    winChance: [0.5, 0.5],
    winHistory: [0.5],
    stats: [zeroStats, zeroStats],
    recentPoints: [{ number: 1, scoreLabel: '0-0(15-0)', server: 1, winner: 1, rallyHits: 0, faults: 0 }],
    courtFrameIndices: [8, 9],
    trajectoryEvents: [
      { frame: 8, kind: 'shot', player: 1, shotType: 'serve', speedKmh: 195 },
      { frame: 9, kind: 'point-end' },
    ],
    soundEvents: [{ frame: 8, kind: 'racket' }],
    court: [[0, 0, 0, 0, 0, 0, 0], [1, 1, 0, 0, 0, 0, 0]],
  };
  const snapshotUpdate = await route.PATCH(
    request({ sequence: 2, snapshot }, `/api/live-dmo/${id}`, 'PATCH'),
    context,
  );
  assert.equal(snapshotUpdate.status, 200);
  const savedSnapshot = JSON.parse(queries[1].values[0]);
  assert.deepEqual(savedSnapshot.courtFrameIndices, [8, 9]);
  assert.deepEqual(savedSnapshot.trajectoryEvents[0], {
    frame: 8,
    kind: 'shot',
    player: 1,
    shotType: 'serve',
    speedKmh: 195,
  });
  assert.equal(savedSnapshot.trajectoryEvents[1].kind, 'point-end');

  const ended = await route.DELETE(request(undefined, `/api/live-dmo/${id}`, 'DELETE'), context);
  assert.equal(ended.status, 200);
  assert.match(queries[2].text, /owner_discord_id=\?.*OR \?/s);
  assert.match(queries[2].text, /status='live'/);
});

test('ending a broadcast edits its Discord post immediately and deletes it one minute later', async () => {
  const id = '7e09e922-44c3-49d7-8211-48f13b8b865a';
  const reference = { channelId: '1562898541238554765', messageId: 'discord-message-123' };
  const payload = {
    ownerName: 'Broadcaster',
    players: ['Alpha', 'Beta'],
    bestOf: 3,
    isWta: true,
    officialByBroadcaster: true,
    likelyOfficial: false,
    stream: { provider: 'twitch', sourceUrl: 'https://www.twitch.tv/example' },
    discordAnnouncement: reference,
  };
  const route = loadRoute('app/api/live-dmo/[id]/route.ts', {
    'next/server': nextServer,
    'zod': require('zod'),
    '@/lib/auth': { getSession: async () => ({ discordId: 'broadcast-owner', isAdmin: false }) },
    '@/lib/liveRequestSecurity': { isSameSiteMutation: () => true },
    '@/lib/db': {
      sql: async () => [{ id, owner_discord_id: 'broadcast-owner', payload }],
    },
    '@/lib/discord': loadDiscordAnnouncements(),
    '@/lib/liveBroadcastAnnouncements': loadAnnouncementLifecycle(loadDiscordAnnouncements()),
  });
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.DISCORD_BOT_TOKEN;
  const originalSetTimeout = globalThis.setTimeout;
  const calls = [];
  const callbackStart = backgroundCallbacks.length;
  process.env.DISCORD_BOT_TOKEN = 'test-bot-token';
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return options.method === 'DELETE' ? new Response(null, { status: 204 }) : Response.json({ id: reference.messageId });
  };
  try {
    const response = await route.DELETE(
      request(undefined, `/api/live-dmo/${id}`, 'DELETE'),
      { params: Promise.resolve({ id }) },
    );
    assert.equal(response.status, 200);
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, new RegExp(`/channels/${reference.channelId}/messages/${reference.messageId}$`));
    assert.equal(calls[0].options.method, 'PATCH');
    const edited = JSON.parse(calls[0].options.body);
    assert.match(edited.content, /Broadcast ended/);
    assert.equal(edited.embeds[0].title, '📺 Watch: Alpha vs Beta');
    assert.match(edited.embeds[0].url, new RegExp(`/livestreams\\?broadcast=${id}#broadcast-${id}$`));
    assert.match(edited.embeds[0].description, /removed in one minute/);
    assert.equal(edited.embeds[0].color, 0x6b7280);
    assert.deepEqual(edited.allowed_mentions, { parse: [], users: [], roles: [] });

    const scheduledDelete = backgroundCallbacks[callbackStart];
    assert.equal(typeof scheduledDelete, 'function');
    let scheduledDelay = 0;
    globalThis.setTimeout = (callback, delay, ...args) => {
      scheduledDelay = delay;
      return originalSetTimeout(callback, 0, ...args);
    };
    await scheduledDelete();
    assert.ok(scheduledDelay > 59_000 && scheduledDelay <= 60_000);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].options.method, 'DELETE');
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
    if (originalToken === undefined) delete process.env.DISCORD_BOT_TOKEN;
    else process.env.DISCORD_BOT_TOKEN = originalToken;
  }
});

test('Forum admins end a broadcast through the same Discord announcement lifecycle', async () => {
  const id = '7e09e922-44c3-49d7-8211-48f13b8b865a';
  const payload = {
    discordAnnouncement: { channelId: '1562898541238554765', messageId: 'discord-message-456' },
  };
  const finished = [];
  const route = loadRoute('app/api/admin/dmo-live/[id]/route.ts', {
    'next/server': nextServer,
    'zod': require('zod'),
    '@/lib/auth': { getSession: async () => ({ discordId: 'forum-admin', isAdmin: true }) },
    '@/lib/liveRequestSecurity': { isSameSiteMutation: () => true },
    '@/lib/db': {
      sql: async () => [{ id, owner_discord_id: 'broadcast-owner', payload }],
    },
    '@/lib/liveBroadcastAnnouncements': {
      finishLiveBroadcastAnnouncement: async (input) => finished.push(input),
    },
  });
  const response = await route.DELETE(
    request(undefined, `/api/admin/dmo-live/${id}`, 'DELETE'),
    { params: Promise.resolve({ id }) },
  );
  assert.equal(response.status, 200);
  assert.equal(finished.length, 1);
  assert.equal(finished[0].ownerDiscordId, 'broadcast-owner');
  assert.equal(finished[0].payload, payload);
});

test('homepage displays video links only when a signed-in viewer has a matching broadcast', () => {
  const liveScores = readFileSync(new URL('../components/LiveScores.tsx', import.meta.url), 'utf8');
  const viewer = readFileSync(new URL('../components/DmoLiveViewer.tsx', import.meta.url), 'utf8');
  assert.match(liveScores, /sameLiveMatch\(/);
  assert.match(liveScores, /live-broadcast-match-link/);
  assert.match(liveScores, /if \(!signedIn\) return/);
  assert.match(viewer, /body\?\.broadcasts/);
});

test('verified replay openings can be shown before the first point; other DMO broadcasts still require one', async () => {
  const timestamp = new Date('2026-10-22T10:00:00Z');
  const rows = [
    { id: 'auto-no-snapshot', payload: { hasDmo: true, mode: 'auto' } },
    { id: 'auto-no-point', payload: { hasDmo: true, mode: 'auto', snapshot: { pointCount: 0 } } },
    {
      id: 'replay-no-point',
      payload: {
        hasDmo: true,
        mode: 'manual',
        replay: true,
        snapshot: { version: 1, frameCount: 10, pointCount: 0, players: ['Replay One', 'Replay Two'], court: [] },
      },
    },
    {
      id: 'replay-no-opening-frame',
      payload: {
        hasDmo: true,
        mode: 'manual',
        replay: true,
        snapshot: { version: 1, frameCount: 9, pointCount: 0, players: ['Replay One', 'Replay Two'], court: [] },
      },
    },
    { id: 'legacy-no-point', payload: { version: 1, pointCount: 0, players: ['Old One', 'Old Two'] } },
    { id: 'auto-parsed', payload: { hasDmo: true, mode: 'auto', isWta: true, character: 'Serena Williams', snapshot: { pointCount: 1, players: ['Alpha', 'Beta'] } } },
    { id: 'replay-parsed', payload: { hasDmo: true, mode: 'manual', replay: true, snapshot: { pointCount: 1, players: ['Gamma', 'Delta'] } } },
    {
      id: 'stream-only',
      payload: {
        hasDmo: false,
        mode: 'manual',
        replay: false,
        stream: { provider: 'youtube', id: 'dQw4w9WgXcQ', sourceUrl: 'https://youtu.be/dQw4w9WgXcQ' },
      },
    },
  ].map((row) => ({
    ...row,
    owner_discord_id: row.id,
    status: 'live',
    sequence: 1,
    started_at: timestamp,
    updated_at: timestamp,
    owner_name: 'Tennis fan',
    stale: false,
  }));
  const route = loadRoute('app/api/live-dmo/current/route.ts', {
    'next/server': nextServer,
    '@/lib/auth': { getSession: async () => ({ id: '22' }) },
    '@/lib/db': { sql: async () => rows },
    '@/lib/te4DmoLive': {
      hasCompletedDmoPoints: (snapshot) => Boolean(snapshot && Number.isInteger(snapshot.pointCount) && snapshot.pointCount > 0),
    },
  });
  const response = await route.GET(request(undefined, '/api/live-dmo/current', 'GET'));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.broadcasts.map((broadcast) => broadcast.id), [
    'replay-no-point',
    'auto-parsed',
    'replay-parsed',
    'stream-only',
  ]);
  assert.equal(body.broadcasts.find((broadcast) => broadcast.id === 'auto-parsed').isWta, true);
  assert.equal(body.broadcasts.find((broadcast) => broadcast.id === 'auto-parsed').character, 'Serena Williams');
  const host = readFileSync(new URL('../components/DmoLiveHost.tsx', import.meta.url), 'utf8');
  assert.match(host, /hasCompletedDmoPoints\(current\)/);
  assert.match(host, /hasCompletedDmoPoints\(matchedSnapshot\)/);
  assert.match(host, /attemptFullReplayPreparation/);
  assert.match(host, /the score-and-court replay is continuing/);
});

test('current broadcasts show one latest match per streamer and hide ended matches after one minute', async () => {
  const now = Date.now();
  const streamPayload = {
    hasDmo: false,
    mode: 'manual',
    replay: false,
    stream: { provider: 'youtube', id: 'dQw4w9WgXcQ', sourceUrl: 'https://youtu.be/dQw4w9WgXcQ' },
  };
  const rows = [
    {
      id: 'latest-live',
      owner_discord_id: 'streamer-one',
      status: 'live',
      payload: streamPayload,
      started_at: new Date(now - 5_000),
      updated_at: new Date(now - 300),
      owner_name: 'Streamer One',
      stale: false,
    },
    {
      id: 'older-live',
      owner_discord_id: 'streamer-one',
      status: 'live',
      payload: streamPayload,
      started_at: new Date(now - 60_000),
      updated_at: new Date(now - 300),
      owner_name: 'Streamer One',
      stale: false,
    },
    {
      id: 'old-ended',
      owner_discord_id: 'streamer-two',
      status: 'ended',
      payload: streamPayload,
      started_at: new Date(now - 10 * 60_000),
      updated_at: new Date(now - 5 * 60_000),
      owner_name: 'Streamer Two',
      stale: false,
    },
    {
      id: 'recent-ended',
      owner_discord_id: 'streamer-three',
      status: 'ended',
      payload: streamPayload,
      started_at: new Date(now - 20_000),
      updated_at: new Date(now - 30_000),
      owner_name: 'Streamer Three',
      stale: false,
    },
  ];
  let queryText = '';
  const route = loadRoute('app/api/live-dmo/current/route.ts', {
    'next/server': nextServer,
    '@/lib/auth': { getSession: async () => ({ id: 'viewer' }) },
    '@/lib/db': {
      sql: async (strings) => {
        queryText = strings.join('?');
        return rows;
      },
    },
    '@/lib/te4DmoLive': { hasCompletedDmoPoints: () => false },
  });

  const response = await route.GET(request(undefined, '/api/live-dmo/current', 'GET'));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).broadcasts.map((broadcast) => broadcast.id), [
    'latest-live',
    'recent-ended',
  ]);
  assert.match(queryText, /PARTITION BY b\.owner_discord_id/);
  assert.match(queryText, /INTERVAL '60 seconds'/);
  assert.match(queryText, /INTERVAL '3 seconds'/);
});

test('signed-in viewers get the official pre-match estimate for a broadcast pair in stored order', async () => {
  const broadcastId = 'ad407a42-df03-4f70-9a8c-11e755683f74';
  let resolvedPair = null;
  const route = loadRoute('app/api/live-dmo/[id]/pre-match/route.ts', {
    'next/server': nextServer,
    'zod': require('zod'),
    '@/lib/auth': { getSession: async () => ({ discordId: 'viewer', isAdmin: false }) },
    '@/lib/db': {
      sql: async () => [{
        payload: { players: ['Squeaky', 'Player Two'], bestOf: 5 },
      }],
    },
    '@/lib/liveScores': {
      getRankedPairPreMatchProbability: async (players, bestOf) => {
        resolvedPair = { players, bestOf };
        return { probability: 64, source: 'official', tour: 'TE4' };
      },
    },
  });

  const response = await route.GET(
    new Request(`https://forum.test/api/live-dmo/${broadcastId}/pre-match`),
    { params: Promise.resolve({ id: broadcastId }) },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(resolvedPair, { players: ['Squeaky', 'Player Two'], bestOf: 5 });
  assert.deepEqual((await response.json()).prediction, {
    probability: 64,
    source: 'official',
    tour: 'TE4',
  });
});
