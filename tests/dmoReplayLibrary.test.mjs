import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { transformSync } = require('next/dist/build/swc');
let te4CoachEmbedModule;

function loadModule(path, mocks) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const { code } = transformSync(source, {
    jsc: { parser: { syntax: 'typescript' }, target: 'es2022' },
    module: { type: 'commonjs' },
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)((name) => {
    if (name in mocks) return mocks[name];
    if (name === '@/lib/auth') return { getSession: async () => ({ isAdmin: true }) };
    if (name === '@/lib/te4CoachEmbed') return te4CoachEmbedModule;
    if (name.startsWith('node:')) return require(name);
    throw new Error(`Unexpected dependency: ${name}`);
  }, module, module.exports);
  return module.exports;
}

te4CoachEmbedModule = loadModule('lib/te4CoachEmbed.ts', {});

function loadTsxModule(path, mocks) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const { code } = transformSync(source, {
    jsc: {
      parser: { syntax: 'typescript', tsx: true },
      target: 'es2022',
      transform: { react: { runtime: 'automatic' } },
    },
    module: { type: 'commonjs' },
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)((name) => {
    if (name in mocks) return mocks[name];
    if (name === '@/lib/auth') return { getSession: async () => ({ isAdmin: true }) };
    if (name === '@/components/LivestreamMaintenance') return { __esModule: true, default: () => null };
    if (name === 'react/jsx-runtime' || name.startsWith('node:')) return require(name);
    throw new Error(`Unexpected dependency: ${name}`);
  }, module, module.exports);
  return module.exports;
}

const nextServer = { NextResponse: { json: (body, init) => Response.json(body, init) } };

test('TE4 Coach links accept only supported public match URLs', () => {
  const {
    parseTe4CoachShareUrl,
    buildTe4CoachEmbedUrl,
    buildTe4CoachAnalysisUrl,
  } = te4CoachEmbedModule;
  const shareUrl = 'https://replays.knowthew.net/m/3f9a1c07b2e4d5a6';
  const liveUrl = 'https://replays.knowthew.net/tv/3f9a1c07b2e4d5a6';
  const dashboardUrl = 'https://replays.knowthew.net/w/0123456789abcdef01234567/?m=2&p=4';

  assert.deepEqual(parseTe4CoachShareUrl(shareUrl), { valid: true, url: shareUrl });
  assert.deepEqual(parseTe4CoachShareUrl(liveUrl), { valid: true, url: liveUrl });
  assert.deepEqual(parseTe4CoachShareUrl(dashboardUrl), { valid: true, url: dashboardUrl });

  const embed = new URL(buildTe4CoachEmbedUrl(shareUrl));
  assert.equal(embed.origin, 'https://replays.knowthew.net');
  assert.equal(embed.pathname, '/embed');
  assert.equal(embed.searchParams.get('share'), shareUrl);

  const analysis = new URL(buildTe4CoachAnalysisUrl(shareUrl));
  assert.equal(analysis.pathname, '/');
  assert.equal(analysis.searchParams.get('share'), shareUrl);

  for (const invalid of [
    'http://replays.knowthew.net/m/3f9a1c07b2e4d5a6',
    'https://replays.knowthew.net.evil.test/m/3f9a1c07b2e4d5a6',
    'https://replays.knowthew.net/embed?share=https://example.test/a.dmo',
    'https://replays.knowthew.net/w/0123456789abcdef01234567/',
    'https://replays.knowthew.net/w/0123456789abcdef01234567/?m=2&next=https://evil.test',
    'https://user@replays.knowthew.net/m/3f9a1c07b2e4d5a6',
  ]) {
    assert.equal(parseTe4CoachShareUrl(invalid).valid, false);
    assert.equal(buildTe4CoachEmbedUrl(invalid), null);
  }
  assert.deepEqual(parseTe4CoachShareUrl(''), { valid: true, url: null });
});

test('public DMO paths must be private-store paths with a DMO filename', () => {
  const { isPublicDmoPath, isDmoReplayId } = loadModule('lib/dmoReplayLibrary.ts', {
    '@/lib/db': { sql: async () => [] },
  });

  for (const path of ['dmo/forum-match.dmo', 'dmo/discord-123-demo.DMO']) {
    assert.equal(isPublicDmoPath(path), true);
  }
  for (const path of [
    null,
    'dmo/../private.dmo',
    'dmo\\private.dmo',
    'public/match.dmo',
    'dmo/recording.mp4',
    'dmo/',
  ]) {
    assert.equal(isPublicDmoPath(path), false);
  }
  for (const id of ['1', '9223372036854775807']) assert.equal(isDmoReplayId(id), true);
  for (const id of ['', '0', '-1', '9223372036854775808', '1.5']) {
    assert.equal(isDmoReplayId(id), false);
  }
});

test('replay listing returns only safe metadata and paginates uploaded DMO files', async () => {
  const queries = [];
  const { listPublicDmoReplays } = loadModule('lib/dmoReplayLibrary.ts', {
    '@/lib/db': {
      sql: async (strings, ...values) => {
        queries.push({ text: strings.join('?'), values });
        return [
          {
            id: '41',
            tournament: 'WTSL Open',
            round_name: 'Final',
            player1: 'One',
            player2: 'Two',
            submission_date: '2026-10-30',
            source: 'discord',
            coach_share_url: 'https://replays.knowthew.net/m/3f9a1c07b2e4d5a6',
          },
          { id: '40', tournament: 'WTSL Open', round_name: 'Semi', player1: 'Three', player2: 'Four', submission_date: '2026-10-29', source: 'forum' },
          { id: '39', tournament: 'WTSL Open', round_name: 'Quarter', player1: 'Five', player2: 'Six', submission_date: '2026-10-28', source: 'forum' },
        ];
      },
    },
  });

  const page = await listPublicDmoReplays({ cursor: '42', query: 'Open', limit: 2 });
  assert.deepEqual(page, {
    matches: [
      {
        id: '41',
        tournament: 'WTSL Open',
        roundName: 'Final',
        player1: 'One',
        player2: 'Two',
        submissionDate: '2026-10-30',
        source: 'discord',
        coachShareUrl: 'https://replays.knowthew.net/m/3f9a1c07b2e4d5a6',
      },
      {
        id: '40',
        tournament: 'WTSL Open',
        roundName: 'Semi',
        player1: 'Three',
        player2: 'Four',
        submissionDate: '2026-10-29',
        source: 'forum',
      },
    ],
    nextCursor: '40',
  });
  assert.match(queries[0].text, /private_blob_pathname LIKE 'dmo\/%'/);
  assert.match(queries[0].text, /public_share_consent IS TRUE/);
  assert.match(queries[0].text, /dmo_replay_publication_overrides/);
  assert.match(queries[0].text, /publication_override\.revoked_at IS NULL/);
  assert.match(queries[0].text, /file_name, private_blob_pathname/);
  assert.match(queries[0].text, /coach_share_url/);
  assert.match(queries[0].text, /CASE WHEN coach_group_share_consent IS TRUE THEN coach_share_url ELSE NULL END/);
  assert.match(queries[0].text, /ORDER BY id DESC/);
  assert.ok(queries[0].values.includes('%Open%'));
  assert.ok(!JSON.stringify(page).includes('private_blob_pathname'));
});

test('replay page server-renders the current public replay page on first load', async () => {
  const initialPage = {
    matches: [{
      id: '41',
      tournament: 'WTSL Open',
      roundName: 'Final',
      player1: 'One',
      player2: 'Two',
      submissionDate: '2026-10-30',
      source: 'discord',
    }],
    nextCursor: null,
  };
  let requestedPage;
  function PageHero() {}
  function DmoReplayLibrary() {}
  function Link() {}
  const pageModule = loadTsxModule('app/replays/page.tsx', {
    'next/link': { __esModule: true, default: Link },
    '@/components/PageHero': { __esModule: true, default: PageHero },
    '@/components/DmoReplayLibrary': { __esModule: true, default: DmoReplayLibrary },
    '@/lib/dmoReplayLibrary': {
      listPublicDmoReplays: async (input) => {
        requestedPage = input;
        return initialPage;
      },
    },
  });

  const page = await pageModule.default({ searchParams: Promise.resolve({}) });
  const [hero, main] = page.props.children;
  assert.equal(hero.type, PageHero);
  assert.equal(main.type, 'main');
  assert.equal(main.props.children.type, DmoReplayLibrary);
  assert.deepEqual(main.props.children.props.initialPage, initialPage);
  assert.deepEqual(requestedPage, { limit: 24 });
});

test('replay detail lookup requires consent or an active owner publication override', async () => {
  const queries = [];
  const { getPublicDmoReplay } = loadModule('lib/dmoReplayLibrary.ts', {
    '@/lib/db': {
      sql: async (strings, ...values) => {
        queries.push({ text: strings.join('?'), values });
        return [];
      },
    },
  });

  assert.equal(await getPublicDmoReplay('21'), null);
  assert.match(queries[0].text, /public_share_consent IS TRUE/);
  assert.match(queries[0].text, /dmo_replay_publication_overrides/);
  assert.match(queries[0].text, /publication_override\.revoked_at IS NULL/);
  assert.match(queries[0].text, /coach_share_url/);
  assert.match(queries[0].text, /CASE WHEN coach_group_share_consent IS TRUE THEN coach_share_url ELSE NULL END/);
});

test('public Coach group lookup requires its separate consent flag', async () => {
  const queries = [];
  const { getPublicDmoCoachReplay } = loadModule('lib/dmoReplayLibrary.ts', {
    '@/lib/db': {
      sql: async (strings, ...values) => {
        queries.push({ text: strings.join('?'), values });
        return [{
          id: '42',
          tournament: 'WTSL Open',
          round_name: 'Final',
          player1: 'One',
          player2: 'Two',
          submission_date: '2026-11-03',
          source: 'forum',
          coach_share_url: 'https://replays.knowthew.net/m/3f9a1c07b2e4d5a6',
        }];
      },
    },
  });

  const replay = await getPublicDmoCoachReplay('42');
  assert.equal(replay.id, '42');
  assert.equal(replay.coachShareUrl, 'https://replays.knowthew.net/m/3f9a1c07b2e4d5a6');
  assert.equal('privateBlobPathname' in replay, false);
  assert.match(queries[0].text, /coach_group_share_consent IS TRUE/);
  assert.match(queries[0].text, /public_share_consent IS TRUE/);
  assert.match(queries[0].text, /dmo_replay_publication_overrides/);
});

test('Discord consent endpoint requires authorization and matches the original submitter', async () => {
  const updates = [];
  const route = loadModule('app/api/sync/dmo-submissions/consent/route.ts', {
    'next/server': nextServer,
    '@/lib/wtslSyncAuth': {
      isWtslSyncAuthorized: (headers) => headers.get('x-wtsl-sync-secret') === 'test-secret',
    },
    '@/lib/dmo-submissions': {
      setDmoSubmissionPublicShareConsent: async (input) => {
        updates.push(input);
        return true;
      },
      findDmoSubmissionByDiscordMessage: async () => ({ id: '88', coach_share_url: null }),
    },
    '@/lib/te4CoachGroupServer': {
      syncPublicDmoSubmissionToTe4CoachGroup: async () => ({ status: 'skipped' }),
    },
  });

  const unauthorized = await route.POST(new Request('https://forum.test/api/sync/dmo-submissions/consent', {
    method: 'POST',
    body: JSON.stringify({
      discordChannelId: '1055277431398866995',
      discordMessageId: '123456789012345678',
      submitterDiscordId: '223456789012345678',
      publicShareConsent: true,
    }),
    headers: { 'content-type': 'application/json' },
  }));
  assert.equal(unauthorized.status, 401);

  const response = await route.POST(new Request('https://forum.test/api/sync/dmo-submissions/consent', {
    method: 'POST',
    body: JSON.stringify({
      discordChannelId: '1055277431398866995',
      discordMessageId: '123456789012345678',
      submitterDiscordId: '223456789012345678',
      publicShareConsent: true,
      coachGroupShareConsent: true,
      coachShareUrl: 'https://replays.knowthew.net/m/3f9a1c07b2e4d5a6',
    }),
    headers: {
      'content-type': 'application/json',
      'x-wtsl-sync-secret': 'test-secret',
    },
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(updates, [{
    discordChannelId: '1055277431398866995',
    discordMessageId: '123456789012345678',
    submitterDiscordId: '223456789012345678',
    coachGroupShareConsent: true,
    coachShareUrl: 'https://replays.knowthew.net/m/3f9a1c07b2e4d5a6',
  }]);

  const replayOnly = await route.POST(new Request('https://forum.test/api/sync/dmo-submissions/consent', {
    method: 'POST',
    body: JSON.stringify({
      discordChannelId: '1055277431398866995',
      discordMessageId: '123456789012345678',
      submitterDiscordId: '223456789012345678',
      publicShareConsent: true,
    }),
    headers: {
      'content-type': 'application/json',
      'x-wtsl-sync-secret': 'test-secret',
    },
  }));
  assert.equal(replayOnly.status, 200);
  assert.equal(updates[1].coachGroupShareConsent, false);
  assert.equal(updates[1].coachShareUrl, null);
});

test('replay metadata endpoint does not expose the private upload path', async () => {
  const route = loadModule('app/api/dmo-replays/[id]/route.ts', {
    'next/server': nextServer,
    '@/lib/dmoReplayLibrary': {
      getPublicDmoReplay: async () => ({
        id: '21',
        tournament: 'WTSL Open',
        roundName: 'Final',
        player1: 'One',
        player2: 'Two',
        submissionDate: '2026-10-30',
        source: 'discord',
        fileName: 'secret-file.dmo',
        privateBlobPathname: 'dmo/discord-123-secret-file.dmo',
      }),
      isDmoReplayId: (value) => /^\d{1,19}$/.test(value) && value !== '0',
      publicDmoReplayMetadata: (replay) => ({
        id: replay.id,
        tournament: replay.tournament,
        roundName: replay.roundName,
        player1: replay.player1,
        player2: replay.player2,
        submissionDate: replay.submissionDate,
        source: replay.source,
      }),
    },
  });

  const response = await route.GET(new Request('https://forum.test/api/dmo-replays/21'), {
    params: Promise.resolve({ id: '21' }),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.id, '21');
  assert.equal('privateBlobPathname' in body, false);
  assert.equal('fileName' in body, false);
});

test('public replay API serves only viewer data and caches it in the private store', async () => {
  const originalStoreId = process.env.MODERATION_BLOB_STORE_ID;
  process.env.MODERATION_BLOB_STORE_ID = 'private-store-test';
  const viewer = {
    names: ['One', 'Two'],
    score: '6-4, 7-5',
    tournament: 'WTSL Open',
    surface: 'hard',
    highlights: [],
    sets: [[6, 4], [7, 5]],
    final: { ss: [[6, 4], [7, 5]], wp: 1 },
    match: { d: 'safe viewer data', n: 2, fps: 60 },
    pts: [],
  };
  const blobReads = [];
  const blobWrites = [];
  let analyzed = 0;
  try {
    const route = loadModule('app/api/dmo-replays/[id]/replay/route.ts', {
      'node:crypto': require('node:crypto'),
      '@vercel/blob': {
        get: async (pathname, options) => {
          blobReads.push({ pathname, options });
          if (pathname.startsWith('dmo-submission-replays/')) return null;
          return {
            statusCode: 200,
            blob: { size: 12 },
            stream: new Response(Buffer.from('private dmo bytes')).body,
          };
        },
        put: async (pathname, body, options) => {
          blobWrites.push({ pathname, body, options });
          return { pathname };
        },
      },
      'next/server': nextServer,
      '@/lib/te4DmoAnalysis': {
        analyzeDmoBuffer: () => {
          analyzed += 1;
          return { viewer };
        },
      },
      '@/lib/te4DmoParser': {
        MAX_DMO_BYTES: 64 * 1024 * 1024,
        Te4DmoAnalysisError: class Te4DmoAnalysisError extends Error {},
      },
      '@/lib/dmoReplayLibrary': {
        isDmoReplayId: (value) => /^\d{1,19}$/.test(value) && value !== '0',
        getPublicDmoReplay: async () => ({
          id: '21',
          tournament: 'WTSL Open',
          roundName: 'Final',
          player1: 'One',
          player2: 'Two',
          submissionDate: '2026-10-30',
          source: 'discord',
          fileName: 'match.dmo',
          privateBlobPathname: 'dmo/discord-123-match.dmo',
        }),
        publicDmoReplayMetadata: (replay) => ({
          id: replay.id,
          tournament: replay.tournament,
          roundName: replay.roundName,
          player1: replay.player1,
          player2: replay.player2,
          submissionDate: replay.submissionDate,
          source: replay.source,
        }),
      },
    });

    const response = await route.GET(new Request('https://forum.test/api/dmo-replays/21/replay'), {
      params: Promise.resolve({ id: '21' }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.viewer, viewer);
    assert.equal(body.match.id, '21');
    assert.equal('privateBlobPathname' in body.match, false);
    assert.equal(analyzed, 1);
    assert.equal(blobReads[0].options.access, 'private');
    assert.equal(blobReads[0].options.storeId, 'private-store-test');
    assert.equal(blobReads[1].pathname, 'dmo/discord-123-match.dmo');
    assert.equal(blobWrites.length, 1);
    assert.equal(blobWrites[0].options.access, 'private');
    assert.deepEqual(JSON.parse(blobWrites[0].body), { viewer });
  } finally {
    if (originalStoreId === undefined) delete process.env.MODERATION_BLOB_STORE_ID;
    else process.env.MODERATION_BLOB_STORE_ID = originalStoreId;
  }
});

test('replay API does not read storage when a submission is not publicly eligible', async () => {
  const originalStoreId = process.env.MODERATION_BLOB_STORE_ID;
  process.env.MODERATION_BLOB_STORE_ID = 'private-store-test';
  let blobReads = 0;
  try {
    const route = loadModule('app/api/dmo-replays/[id]/replay/route.ts', {
      'node:crypto': require('node:crypto'),
      '@vercel/blob': { get: async () => { blobReads += 1; return null; } },
      'next/server': nextServer,
      '@/lib/te4DmoAnalysis': { analyzeDmoBuffer: () => { throw new Error('should not analyze'); } },
      '@/lib/te4DmoParser': {
        MAX_DMO_BYTES: 64 * 1024 * 1024,
        Te4DmoAnalysisError: class Te4DmoAnalysisError extends Error {},
      },
      '@/lib/dmoReplayLibrary': {
        isDmoReplayId: (value) => /^\d{1,19}$/.test(value) && value !== '0',
        getPublicDmoReplay: async () => null,
        publicDmoReplayMetadata: () => null,
      },
    });
    const response = await route.GET(new Request('https://forum.test/api/dmo-replays/21/replay'), {
      params: Promise.resolve({ id: '21' }),
    });
    assert.equal(response.status, 404);
    assert.equal(blobReads, 0);
  } finally {
    if (originalStoreId === undefined) delete process.env.MODERATION_BLOB_STORE_ID;
    else process.env.MODERATION_BLOB_STORE_ID = originalStoreId;
  }
});
