import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { transformSync } = require('next/dist/build/swc');

function loadModule(path, mocks) {
  const source = require('node:fs').readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const { code } = transformSync(source, {
    jsc: { parser: { syntax: 'typescript' }, target: 'es2022' },
    module: { type: 'commonjs' },
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(
    (name) => {
      if (name in mocks) return mocks[name];
      throw new Error(`Unexpected dependency: ${name}`);
    },
    module,
    module.exports,
  );
  return module.exports;
}

function makeSql(handler) {
  const calls = [];
  const sql = async (strings, ...values) => {
    const query = strings.join(' ');
    calls.push({ query, values });
    return handler(query, values);
  };
  return { sql, calls };
}

const nextServer = { NextResponse: { json: (body, init) => Response.json(body, init) } };

test('Discord mention DMs go only to verified exact usernames, once per recipient', async () => {
  const sent = [];
  const { sql, calls } = makeSql((query, values) => {
    assert.match(query, /lower\(username\) = ANY/);
    assert.match(query, /verified_player_id IS NOT NULL/);
    assert.match(query, /id <>/);
    assert.deepEqual(values, [['ace', 'second'], 12]);
    return [
      { id: 21, discord_id: 'discord-21' },
      { id: 21, discord_id: 'discord-21' },
      { id: 22, discord_id: 'discord-22' },
    ];
  });
  const notifications = loadModule('lib/forumNotifications.ts', {
    './db': { sql },
    './discord': { sendDM: async (...args) => sent.push(args) },
  });

  await notifications.notifyForumMentions({
    body: 'Hi @Ace, also @second. Email person@outside is not a tag; @ace again.',
    authorUserId: 12,
    authorName: 'Author',
    context: 'in a discussion',
    href: '/discussions/43',
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(sent.map(([id]) => id), ['discord-21', 'discord-22']);
  assert.ok(sent.every(([, message]) => message.includes('https://www.wtslforum.com/discussions/43')));
  assert.ok(sent.every(([, message]) => message.includes('Author mentioned you in a discussion')));
  assert.ok(sent.every(([, message]) => !message.includes('person@outside')));
});

test('mention notifications do not query or send when the body has no tags', async () => {
  let queried = false;
  const notifications = loadModule('lib/forumNotifications.ts', {
    './db': { sql: async () => { queried = true; return []; } },
    './discord': { sendDM: async () => assert.fail('unexpected notification') },
  });

  await notifications.notifyForumMentions({
    body: 'No mentions here.',
    authorUserId: 12,
    authorName: 'Author',
    context: 'in a discussion',
    href: '/discussions/43',
  });

  assert.equal(queried, false);
});

test('editing a published post only notifies users newly mentioned', async () => {
  const sent = [];
  const { sql } = makeSql((_query, values) => {
    assert.deepEqual(values, [['new'], 12]);
    return [{ id: 22, discord_id: 'discord-22' }];
  });
  const notifications = loadModule('lib/forumNotifications.ts', {
    './db': { sql },
    './discord': { sendDM: async (...args) => sent.push(args) },
  });

  await notifications.notifyForumMentions({
    body: 'Still here @old, and now @new.',
    previousBody: 'Earlier @old mention.',
    authorUserId: 12,
    authorName: 'Author',
    context: 'in a discussion reply',
    href: '/discussions/43',
  });

  assert.deepEqual(sent.map(([id]) => id), ['discord-22']);
});

test('new direct-message notices link back to the conversation without quoting private text', async () => {
  const sent = [];
  const notifications = loadModule('lib/forumNotifications.ts', {
    './db': { sql: async () => [{ discord_id: 'discord-21' }] },
    './discord': { sendDM: async (...args) => sent.push(args) },
  });

  await notifications.notifyForumDirectMessage({
    recipientUserId: 21,
    senderUserId: 12,
    senderName: 'Author',
  });

  assert.equal(sent.length, 1);
  assert.equal(sent[0][0], 'discord-21');
  assert.match(sent[0][1], /Author sent you a direct message/);
  assert.match(sent[0][1], /https:\/\/www\.wtslforum\.com\/messages\/12/);
  assert.doesNotMatch(sent[0][1], /message body/i);
});

test('direct-message route notifies the recipient after the message is stored', async () => {
  const calls = [];
  const route = loadModule('app/api/messages/route.ts', {
    'next/server': nextServer,
    '@/lib/auth': { getSession: async () => ({ id: '12', username: 'Author' }) },
    '@/lib/messages': {
      listConversations: async () => [],
      sendMessage: async (...args) => { calls.push(['store', ...args]); return { id: 1 }; },
    },
    '@/lib/db': { safe: async (run) => run() },
    '@/lib/forumNotifications': {
      notifyForumDirectMessage: async (input) => calls.push(['notify', input]),
    },
  });

  const response = await route.POST(new Request('https://forum.test/api/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ to: 21, body: 'Private message text' }),
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(calls, [
    ['store', '12', 21, 'Private message text'],
    ['notify', { recipientUserId: 21, senderUserId: '12', senderName: 'Author' }],
  ]);
});

test('replying in an existing direct-message thread notifies its recipient', async () => {
  const calls = [];
  const route = loadModule('app/api/messages/[userId]/route.ts', {
    'next/server': nextServer,
    '@/lib/auth': { getSession: async () => ({ id: '12', username: 'Author' }) },
    '@/lib/messages': {
      getThread: async () => [],
      markThreadRead: async () => {},
      sendMessage: async (...args) => { calls.push(['store', ...args]); return { id: 2 }; },
    },
    '@/lib/db': { safe: async (run) => run() },
    '@/lib/forumNotifications': {
      notifyForumDirectMessage: async (input) => calls.push(['notify', input]),
    },
  });

  const response = await route.POST(
    new Request('https://forum.test/api/messages/21', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'Another private message' }),
    }),
    { params: Promise.resolve({ userId: '21' }) },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(calls, [
    ['store', '12', '21', 'Another private message'],
    ['notify', { recipientUserId: '21', senderUserId: '12', senderName: 'Author' }],
  ]);
});

test('Discord delivery failure never prevents a Forum message from being accepted', async () => {
  const notifications = loadModule('lib/forumNotifications.ts', {
    './db': { sql: async () => [{ discord_id: 'discord-21' }] },
    './discord': { sendDM: async () => { throw new Error('Discord unavailable'); } },
  });
  await assert.doesNotReject(() => notifications.notifyForumDirectMessage({
    recipientUserId: 21,
    senderUserId: 12,
    senderName: 'Author',
  }));
});
