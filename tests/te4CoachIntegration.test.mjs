import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { transformSync } = require('next/dist/build/swc');

function loadModule(path, mocks = {}) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const { code } = transformSync(source, {
    jsc: { parser: { syntax: 'typescript' }, target: 'es2022' },
    module: { type: 'commonjs' },
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)((name) => {
    if (name in mocks) return mocks[name];
    if (name.startsWith('node:')) return require(name);
    throw new Error(`Unexpected dependency: ${name}`);
  }, module, module.exports);
  return module.exports;
}

const embed = loadModule('lib/te4CoachEmbed.ts');
const group = loadModule('lib/te4CoachGroup.ts', {
  '@/lib/te4CoachEmbed': embed,
});
const insights = loadModule('lib/te4CoachInsights.ts');

test('Coach replay modes build safe scorecard and group links', () => {
  const share = 'https://replays.knowthew.net/w/0123456789abcdef01234567/?m=2&p=4';
  const scorecard = new URL(embed.buildTe4CoachScorecardEmbedUrl(share));
  assert.equal(scorecard.pathname, '/embed');
  assert.equal(scorecard.searchParams.get('part'), 'sheet');
  assert.equal(scorecard.searchParams.get('rows'), 'game');
  assert.equal(scorecard.searchParams.get('head'), '0');
  assert.equal(scorecard.searchParams.get('spoiler'), '1');

  const groupLink = new URL(embed.buildTe4CoachGroupMatchUrl(share));
  assert.equal(groupLink.searchParams.get('m'), '2');
  assert.equal(groupLink.searchParams.has('p'), false);
  assert.equal(embed.buildTe4CoachGroupMatchUrl('https://example.test/replay'), null);
});

test('group entries preserve match labels and exclude point-specific replay links', () => {
  const entry = group.buildTe4CoachGroupEntry({
    id: '321',
    tournament: 'WTSL Masters',
    roundName: 'Final',
    player1: 'One',
    player2: 'Two',
    submissionDate: '2026-11-03',
    coachShareUrl: 'https://replays.knowthew.net/w/0123456789abcdef01234567/?m=2&p=4',
  });
  assert.deepEqual(entry, {
    link: 'https://replays.knowthew.net/w/0123456789abcdef01234567/?m=2',
    match: 'forum-dmo-321',
    event: 'WTSL Masters',
    round: 'Final',
    date: '2026-11-03',
  });
  assert.equal(group.buildTe4CoachGroupEntry({
    id: '321',
    tournament: 'WTSL Masters',
    roundName: 'Final',
    player1: 'One',
    player2: 'Two',
    submissionDate: '2026-11-03',
  }), null);
});

test('player cards and insight embeds use documented public endpoints', () => {
  const playersUrl = new URL(embed.buildTe4CoachGroupPlayersApiUrl('g337hxh'));
  assert.equal(playersUrl.pathname, '/api/groups/g337hxh/players');

  const player = new URL(embed.buildTe4CoachPlayerEmbedUrl('g337hxh', 'player-42'));
  assert.equal(player.pathname, '/embed/player');
  assert.equal(player.searchParams.get('group'), 'g337hxh');
  assert.equal(player.searchParams.get('player'), 'player-42');

  const insight = new URL(embed.buildTe4CoachInsightEmbedUrl('danger-zone'));
  assert.equal(insight.pathname, '/embed/insight');
  assert.equal(insight.searchParams.get('id'), 'danger-zone');
  assert.equal(embed.buildTe4CoachInsightEmbedUrl('bad/id'), null);
});

test('insight parsers retain the provider caveat, sample, and date', () => {
  const index = insights.parseTe4CoachInsightIndex({
    insights: [{ id: 'danger-zone', question: 'How costly is a ball in the Danger Zone?' }],
    everyone: { matches: 1379, players: 449, shots: 507803, as_of: '2026-11-03' },
  });
  assert.equal(index.everyone.shots, 507803);
  assert.equal(index.everyone.asOf, '2026-11-03');

  const detail = insights.parseTe4CoachInsightDetail({
    id: 'danger-zone',
    question: 'How costly is a ball in the Danger Zone?',
    sentence: 'Players win 54% of points from a clean ball.',
    caveat: 'These patterns are not proof of cause.',
    shots: 328756,
    matches: 1379,
    as_of: '2026-11-03',
  });
  assert.equal(detail.shots, 328756);
  assert.equal(detail.caveat, 'These patterns are not proof of cause.');
  assert.equal(detail.asOf, '2026-11-03');
  assert.equal(insights.parseTe4CoachInsightDetail({ id: 'danger-zone' }), null);
});

test('group API writes keep edit credentials in the request header', async () => {
  const originalFetch = globalThis.fetch;
  const originalGroupId = process.env.TE4_COACH_GROUP_ID;
  const originalEditCode = process.env.TE4_COACH_GROUP_EDIT_CODE;
  const calls = [];
  process.env.TE4_COACH_GROUP_ID = 'g337hxh';
  process.env.TE4_COACH_GROUP_EDIT_CODE = 'test-edit-code';
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return Response.json({ pending: 1, problems: 0 }, { status: 202 });
  };

  try {
    const server = loadModule('lib/te4CoachGroupServer.ts', {
      'server-only': {},
      '@/lib/dmoReplayLibrary': {
        getPublicDmoCoachReplay: async (id) => id === '321' ? ({
          id: '321',
          tournament: 'WTSL Masters',
          roundName: 'Final',
          player1: 'One',
          player2: 'Two',
          submissionDate: '2026-11-03',
          source: 'forum',
          coachShareUrl: 'https://replays.knowthew.net/m/3f9a1c07b2e4d5a6',
        }) : null,
        isDmoReplayId: (id) => /^\d+$/.test(id),
      },
      '@/lib/te4CoachGroup': group,
      '@/lib/te4CoachEmbed': embed,
    });
    const result = await server.syncPublicDmoSubmissionToTe4CoachGroup('321');
    assert.equal(result.status, 'synced');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://replays.knowthew.net/api/groups/g337hxh/add');
    assert.equal(calls[0].options.headers['x-edit'], 'test-edit-code');
    assert.equal(JSON.parse(calls[0].options.body).links[0].match, 'forum-dmo-321');
    assert.equal((await server.syncPublicDmoSubmissionToTe4CoachGroup('322')).status, 'skipped');
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalGroupId === undefined) delete process.env.TE4_COACH_GROUP_ID;
    else process.env.TE4_COACH_GROUP_ID = originalGroupId;
    if (originalEditCode === undefined) delete process.env.TE4_COACH_GROUP_EDIT_CODE;
    else process.env.TE4_COACH_GROUP_EDIT_CODE = originalEditCode;
  }
});
