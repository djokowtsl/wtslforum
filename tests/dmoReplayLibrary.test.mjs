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

test('stored DMO paths must be private-store paths with a DMO filename', () => {
  const { isDmoSubmissionPath, isDmoReplayId } = loadModule('lib/dmoReplayLibrary.ts', {
    '@/lib/db': { sql: async () => [] },
  });

  for (const path of ['dmo/forum-match.dmo', 'dmo/discord-123-demo.DMO']) {
    assert.equal(isDmoSubmissionPath(path), true);
  }
  for (const path of [
    null,
    'dmo/../private.dmo',
    'dmo\\private.dmo',
    'public/match.dmo',
    'dmo/recording.mp4',
    'dmo/',
  ]) {
    assert.equal(isDmoSubmissionPath(path), false);
  }
  for (const id of ['1', '9223372036854775807']) assert.equal(isDmoReplayId(id), true);
  for (const id of ['', '0', '-1', '9223372036854775808', '1.5']) {
    assert.equal(isDmoReplayId(id), false);
  }
});

test('replay character picks map to their saved player slots and preserve one-handed backhands', () => {
  const backhandModule = loadModule('lib/liveCharacterBackhand.mjs', {});
  const {
    buildDmoReplayCharacterSetupIndex,
    resolveDmoReplayCharacterPresentation,
  } = loadModule('lib/dmoReplayCharacterStyles.ts', {
    './liveCharacterBackhand.mjs': backhandModule,
  });
  const setups = buildDmoReplayCharacterSetupIndex([{
    character: 'Roger Federer',
    playing_hand: 'right',
    backhand_type: 'one-handed',
  }]);
  const presentation = resolveDmoReplayCharacterPresentation(
    ['Squeaky', 'maastodontee'],
    ['roger   federer', 'Roger Federer'],
    setups,
  );

  assert.deepEqual(presentation.handedness, ['right', 'right']);
  assert.deepEqual(presentation.strokeStyles, [
    { forehand: 'one', backhand: 'one' },
    { forehand: 'one', backhand: 'one' },
  ]);
  assert.deepEqual(presentation.missingBackhandStyle, [false, false]);
});

test('legacy Discord character annotations resolve both Federer slots without guessing member names', () => {
  const backhandModule = loadModule('lib/liveCharacterBackhand.mjs', {});
  const { dmoReplayCharacterNames, buildDmoReplayCharacterSetupIndex, resolveDmoReplayCharacterPresentation } =
    loadModule('lib/dmoReplayCharacterStyles.ts', { './liveCharacterBackhand.mjs': backhandModule });
  const players = ['Squeaky (Roger Federer)', 'maastodontee (Roger Federer)'];
  const names = dmoReplayCharacterNames(players, [null, null]);
  assert.deepEqual(names, ['Roger Federer', 'Roger Federer']);
  const setups = buildDmoReplayCharacterSetupIndex([{
    character: 'Roger Federer', playing_hand: 'right', backhand_type: 'one-handed',
  }]);
  const presentation = resolveDmoReplayCharacterPresentation(players, names, setups);
  assert.deepEqual(presentation.strokeStyles.map(style => style.backhand), ['one', 'one']);
  assert.deepEqual(presentation.missingBackhandStyle, [false, false]);
  assert.deepEqual(dmoReplayCharacterNames(players, ['Rafael Nadal', '  Roger Federer  ']),
    ['Rafael Nadal', 'Roger Federer']);
  assert.deepEqual(dmoReplayCharacterNames(['Roger Federer', 'Squeaky'], [null, '']),
    [null, null]);
  const unknown = dmoReplayCharacterNames(['Member (captain)', 'Other'], [null, null]);
  assert.deepEqual(resolveDmoReplayCharacterPresentation(['Member', 'Other'], unknown, setups)
    .missingBackhandStyle, [true, false]);
});

test('replay viewers hide character grip details and use a light palette in light mode', async () => {
  const component = readFileSync(new URL('../components/DmoReplayLibrary.tsx', import.meta.url), 'utf8');
  const styles = readFileSync(new URL('../components/DmoReplayLibrary.module.css', import.meta.url), 'utf8');
  const globalStyles = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  assert.doesNotMatch(component, /characterStyleSummary|right-handed|left-handed|one-handed backhand|two-handed backhand/);
  assert.match(component, /className=\{`\$\{styles\.library\} replay-library`\}/);
  assert.match(globalStyles, /:root\[data-theme='light'\] \.replay-library\s*\{[\s\S]*?--panel:\s*#fff;/);
  assert.match(globalStyles, /:root\[data-theme='light'\] \.replay-library \.replay-library-panel/);
  assert.doesNotMatch(styles, /characterStyleNote/);
});

test('Match Replay Center catalog includes every submission and only safe recording links', async () => {
  const queries = [];
  const { listDmoReplaySubmissions } = loadModule('lib/dmoReplayLibrary.ts', {
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
            player1_character: 'Roger Federer',
            player2_character: 'Roger Federer',
            submission_date: '2026-10-30',
            source: 'discord',
            private_blob_pathname: 'dmo/discord-123-final.dmo',
            file_name: 'final.dmo',
            external_url: 'https://example.test/replay',
            public_share_consent: true,
            coach_share_url: 'https://replays.knowthew.net/m/3f9a1c07b2e4d5a6',
            coach_group_share_consent: true,
          },
          {
            id: '40',
            tournament: 'WTSL Open',
            round_name: 'Semi',
            player1: 'Three',
            player2: 'Four',
            submission_date: '2026-10-29',
            source: 'forum',
            private_blob_pathname: null,
            file_name: null,
            external_url: 'javascript:alert(1)',
            public_share_consent: false,
            coach_share_url: 'https://replays.knowthew.net/m/3f9a1c07b2e4d5a6',
            coach_group_share_consent: false,
          },
          {
            id: '39',
            tournament: 'WTSL Open',
            round_name: 'Quarter',
            player1: 'Five',
            player2: 'Six',
            submission_date: '2026-10-28',
            source: 'forum',
            private_blob_pathname: null,
            file_name: null,
            external_url: null,
            coach_share_url: null,
            coach_group_share_consent: false,
          },
        ];
      },
    },
  });

  const page = await listDmoReplaySubmissions({ cursor: '42', query: 'Open', limit: 2 });
  assert.deepEqual(page, {
    matches: [
      {
        id: '41',
        tournament: 'WTSL Open',
        roundName: 'Final',
        player1: 'One',
        player2: 'Two',
        player1Character: 'Roger Federer',
        player2Character: 'Roger Federer',
        submissionDate: '2026-10-30',
        source: 'discord',
        hasDmoFile: true,
        externalUrl: 'https://example.test/replay',
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
        hasDmoFile: false,
      },
    ],
    nextCursor: '40',
  });
  assert.match(queries[0].text, /CASE WHEN coach_group_share_consent IS TRUE[\s\S]*public_share_consent IS TRUE[\s\S]*dmo_replay_publication_overrides[\s\S]*revoked_at IS NULL/);
  const listingWhere = queries[0].text.slice(
    queries[0].text.lastIndexOf('WHERE'),
    queries[0].text.indexOf('ORDER BY'),
  );
  assert.doesNotMatch(listingWhere, /public_share_consent|dmo_replay_publication_overrides/);
  assert.match(queries[0].text, /external_url/);
  assert.match(queries[0].text, /player1_character,player2_character/);
  assert.match(queries[0].text, /coach_group_share_consent/);
  assert.match(queries[0].text, /ORDER BY id DESC/);
  assert.ok(queries[0].values.includes('%Open%'));
  assert.ok(!JSON.stringify(page).includes('private_blob_pathname'));
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
            player1_character: 'Private character one',
            player2_character: 'Private character two',
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
  assert.doesNotMatch(queries[0].text, /player1_character|player2_character/);
  assert.match(queries[0].text, /ORDER BY id DESC/);
  assert.ok(queries[0].values.includes('%Open%'));
  assert.ok(!JSON.stringify(page).includes('private_blob_pathname'));
});

test('replay page server-renders the current submissions on first load', async () => {
  const initialPage = {
    matches: [{
      id: '41',
      tournament: 'WTSL Open',
      roundName: 'Final',
      player1: 'One',
      player2: 'Two',
      submissionDate: '2026-10-30',
      source: 'discord',
      hasDmoFile: true,
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
      listDmoReplaySubmissions: async (input) => {
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

test('Match Replay Center catalog stays sign-in-only', async () => {
  let listed = false;
  const route = loadModule('app/api/dmo-replays/route.ts', {
    'next/server': nextServer,
    '@/lib/auth': { getSession: async () => null },
    '@/lib/dmoReplayLibrary': {
      isDmoReplayId: (value) => /^\d{1,19}$/.test(value) && value !== '0',
      listDmoReplaySubmissions: async () => {
        listed = true;
        return { matches: [], nextCursor: null };
      },
    },
  });

  const response = await route.GET(new Request('https://forum.test/api/dmo-replays'));
  assert.equal(response.status, 401);
  assert.equal(listed, false);
});

test('Match Replay Center details stay sign-in-only', async () => {
  let lookedUp = false;
  const route = loadModule('app/api/dmo-replays/[id]/route.ts', {
    'next/server': nextServer,
    '@/lib/auth': { getSession: async () => null },
    '@/lib/dmoReplayLibrary': {
      isDmoReplayId: (value) => /^\d{1,19}$/.test(value) && value !== '0',
      getDmoReplaySubmission: async () => {
        lookedUp = true;
        return null;
      },
      dmoReplayCatalogMetadata: () => null,
    },
  });

  const response = await route.GET(new Request('https://forum.test/api/dmo-replays/21'), {
    params: Promise.resolve({ id: '21' }),
  });
  assert.equal(response.status, 401);
  assert.equal(lookedUp, false);
});

test('legacy public replay lookup still requires consent or an active owner override', async () => {
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

test('Match Replay Center detail lookup includes unconsented submissions', async () => {
  const queries = [];
  const { getDmoReplaySubmission, dmoReplayCatalogMetadata } = loadModule('lib/dmoReplayLibrary.ts', {
    '@/lib/db': {
      sql: async (strings, ...values) => {
        queries.push({ text: strings.join('?'), values });
        return [{
          id: '21',
          tournament: 'WTSL Open',
          round_name: 'Final',
          player1: 'One',
          player2: 'Two',
          player1_character: 'Roger Federer',
          player2_character: 'Roger Federer',
          submission_date: '2026-10-30',
          source: 'discord',
          public_share_consent: false,
          coach_group_share_consent: false,
          private_blob_pathname: 'dmo/discord-123-secret.dmo',
          file_name: 'secret.dmo',
          external_url: null,
          coach_share_url: null,
        }];
      },
    },
  });

  const replay = await getDmoReplaySubmission('21');
  assert.equal(replay.id, '21');
  assert.equal(replay.hasDmoFile, true);
  assert.equal(replay.player1Character, 'Roger Federer');
  assert.equal(replay.player2Character, 'Roger Federer');
  const metadata = dmoReplayCatalogMetadata(replay);
  assert.equal(metadata.player1Character, 'Roger Federer');
  assert.equal(metadata.player2Character, 'Roger Federer');
  assert.equal(replay.privateBlobPathname, 'dmo/discord-123-secret.dmo');
  assert.match(queries[0].text, /player1_character,player2_character/);
  assert.match(queries[0].text, /CASE WHEN coach_group_share_consent IS TRUE[\s\S]*public_share_consent IS TRUE[\s\S]*dmo_replay_publication_overrides[\s\S]*revoked_at IS NULL/);
  const detailWhere = queries[0].text.slice(queries[0].text.lastIndexOf('WHERE'));
  assert.doesNotMatch(detailWhere, /public_share_consent|dmo_replay_publication_overrides/);
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

test('replay metadata endpoint exposes catalog fields without the private upload path', async () => {
  const route = loadModule('app/api/dmo-replays/[id]/route.ts', {
    'next/server': nextServer,
    '@/lib/dmoReplayLibrary': {
      getDmoReplaySubmission: async () => ({
        id: '21',
        tournament: 'WTSL Open',
        roundName: 'Final',
        player1: 'One',
        player2: 'Two',
        player1Character: 'Roger Federer',
        player2Character: 'Roger Federer',
        submissionDate: '2026-10-30',
        source: 'discord',
        hasDmoFile: true,
        externalUrl: 'https://example.test/replay',
        fileName: 'secret-file.dmo',
        privateBlobPathname: 'dmo/discord-123-secret-file.dmo',
      }),
      isDmoReplayId: (value) => /^\d{1,19}$/.test(value) && value !== '0',
      dmoReplayCatalogMetadata: (replay) => ({
        id: replay.id,
        tournament: replay.tournament,
        roundName: replay.roundName,
        player1: replay.player1,
        player2: replay.player2,
        submissionDate: replay.submissionDate,
        source: replay.source,
        hasDmoFile: replay.hasDmoFile,
        externalUrl: replay.externalUrl,
        player1Character: replay.player1Character,
        player2Character: replay.player2Character,
      }),
    },
  });

  const response = await route.GET(new Request('https://forum.test/api/dmo-replays/21'), {
    params: Promise.resolve({ id: '21' }),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.id, '21');
  assert.equal(body.hasDmoFile, true);
  assert.equal(body.externalUrl, 'https://example.test/replay');
  assert.equal(body.player1Character, 'Roger Federer');
  assert.equal(body.player2Character, 'Roger Federer');
  assert.equal('privateBlobPathname' in body, false);
  assert.equal('fileName' in body, false);
});

test('signed-in replay API serves unconsented DMO data and caches it privately', async () => {
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
        getDmoReplaySubmission: async () => ({
          id: '21',
          tournament: 'WTSL Open',
          roundName: 'Final',
          player1: 'One',
          player2: 'Two',
          submissionDate: '2026-10-30',
          source: 'discord',
          hasDmoFile: true,
          fileName: 'match.dmo',
          privateBlobPathname: 'dmo/discord-123-match.dmo',
        }),
        dmoReplayCatalogMetadata: (replay) => ({
          id: replay.id,
          tournament: replay.tournament,
          roundName: replay.roundName,
          player1: replay.player1,
          player2: replay.player2,
          submissionDate: replay.submissionDate,
          source: replay.source,
          hasDmoFile: replay.hasDmoFile,
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

test('replay file API stays sign-in-only', async () => {
  let blobReads = 0;
  const route = loadModule('app/api/dmo-replays/[id]/replay/route.ts', {
    'node:crypto': require('node:crypto'),
    '@vercel/blob': { get: async () => { blobReads += 1; return null; }, put: async () => ({}) },
    'next/server': nextServer,
    '@/lib/auth': { getSession: async () => null },
    '@/lib/te4DmoAnalysis': { analyzeDmoBuffer: () => { throw new Error('should not analyze'); } },
    '@/lib/te4DmoParser': {
      MAX_DMO_BYTES: 64 * 1024 * 1024,
      Te4DmoAnalysisError: class Te4DmoAnalysisError extends Error {},
    },
    '@/lib/dmoReplayLibrary': {
      isDmoReplayId: (value) => /^\d{1,19}$/.test(value) && value !== '0',
      getDmoReplaySubmission: async () => {
        throw new Error('guest reached private submission lookup');
      },
      dmoReplayCatalogMetadata: () => null,
    },
  });

  const response = await route.GET(new Request('https://forum.test/api/dmo-replays/21/replay'), {
    params: Promise.resolve({ id: '21' }),
  });
  assert.equal(response.status, 401);
  assert.equal(blobReads, 0);
});

test('replay API does not read storage when a submission is missing', async () => {
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
        getDmoReplaySubmission: async () => null,
        dmoReplayCatalogMetadata: () => null,
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

test('link-only submissions do not attempt to load a private DMO file', async () => {
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
        getDmoReplaySubmission: async () => ({
          id: '21',
          hasDmoFile: false,
          externalUrl: 'https://example.test/replay',
          privateBlobPathname: null,
          fileName: null,
        }),
        dmoReplayCatalogMetadata: () => null,
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

test('direct DMO upload paths are scoped to the signed-in submitter', () => {
  const {
    buildDmoSubmissionUploadPath,
    isOwnedDmoSubmissionUploadPath,
  } = loadModule('lib/dmoSubmissionUpload.ts', {});
  const pathname = buildDmoSubmissionUploadPath(
    '42',
    'd7c0201d-0c78-4b59-a876-82bba0d1f3ef',
    'Roger Federer final.dmo',
  );

  assert.equal(pathname, 'dmo/42/d7c0201d-0c78-4b59-a876-82bba0d1f3ef-Roger_Federer_final.dmo');
  assert.equal(isOwnedDmoSubmissionUploadPath(pathname, '42'), true);
  assert.equal(isOwnedDmoSubmissionUploadPath(pathname, '43'), false);
  assert.equal(isOwnedDmoSubmissionUploadPath(pathname.replace('.dmo', '.txt'), '42'), false);
});

test('private DMO client upload authorization is authenticated and size-limited', async () => {
  const originalStoreId = process.env.MODERATION_BLOB_STORE_ID;
  process.env.MODERATION_BLOB_STORE_ID = 'private-store-test';
  let currentUser = { id: '42' };
  let requestedPath = 'dmo/42/d7c0201d-0c78-4b59-a876-82bba0d1f3ef-match.dmo';
  const signedRequests = [];
  const deleted = [];
  try {
    const route = loadModule('app/api/dmo-submissions/upload/route.ts', {
      '@vercel/blob': {
        issueSignedToken: async (options) => {
          signedRequests.push(options);
          return { delegationToken: 'test-token' };
        },
        del: async (pathname, options) => deleted.push({ pathname, options }),
      },
      '@vercel/blob/client': {
        handleUploadPresigned: async ({ getSignedToken }) => {
          const result = await getSignedToken(requestedPath, null, false);
          return { type: 'blob.generate-presigned-url', presignedUrlPayload: result };
        },
      },
      'next/server': nextServer,
      '@/lib/auth': { getSession: async () => currentUser },
      '@/lib/dmoSubmissionUpload': loadModule('lib/dmoSubmissionUpload.ts', {}),
    });
    const response = await route.POST(new Request('https://forum.test/api/dmo-submissions/upload', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'upload' }),
    }));
    assert.equal(response.status, 200);
    assert.equal(signedRequests.length, 1);
    assert.equal(signedRequests[0].pathname, requestedPath);
    assert.deepEqual(signedRequests[0].operations, ['put']);
    assert.equal(signedRequests[0].maximumSizeInBytes, 20 * 1024 * 1024);
    assert.deepEqual(signedRequests[0].allowedContentTypes, ['application/octet-stream']);
    assert.equal(signedRequests[0].storeId, 'private-store-test');

    requestedPath = requestedPath.replace('dmo/42/', 'dmo/43/');
    const invalidPathResponse = await route.POST(new Request('https://forum.test/api/dmo-submissions/upload', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'upload' }),
    }));
    assert.equal(invalidPathResponse.status, 400);
    assert.equal(signedRequests.length, 1);

    const deleteResponse = await route.DELETE(new Request('https://forum.test/api/dmo-submissions/upload', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        pathname: 'dmo/42/d7c0201d-0c78-4b59-a876-82bba0d1f3ef-match.dmo',
      }),
    }));
    assert.equal(deleteResponse.status, 200);
    assert.equal(deleted.length, 1);

    currentUser = null;
    const unauthorizedResponse = await route.POST(new Request('https://forum.test/api/dmo-submissions/upload', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'upload' }),
    }));
    assert.equal(unauthorizedResponse.status, 401);
  } finally {
    if (originalStoreId === undefined) delete process.env.MODERATION_BLOB_STORE_ID;
    else process.env.MODERATION_BLOB_STORE_ID = originalStoreId;
  }
});

test('Forum DMO submission accepts only an owned, verified private upload', async () => {
  const originalStoreId = process.env.MODERATION_BLOB_STORE_ID;
  process.env.MODERATION_BLOB_STORE_ID = 'private-store-test';
  const created = [];
  const discordDeliveries = [];
  let blobReads = 0;
  try {
    const route = loadModule('app/api/dmo-submissions/route.ts', {
      '@vercel/blob': {
        head: async (pathname, options) => {
          blobReads += 1;
          assert.equal(pathname, 'dmo/42/d7c0201d-0c78-4b59-a876-82bba0d1f3ef-match.dmo');
          assert.deepEqual(options, { storeId: 'private-store-test' });
          return { size: 2048, contentType: 'application/octet-stream' };
        },
        get: async () => ({
          statusCode: 200,
          stream: new Blob([new Uint8Array([1])]).stream(),
          blob: { contentType: 'application/octet-stream' },
        }),
        del: async () => {},
        put: async () => { throw new Error('Should use the direct private upload.'); },
      },
      'next/server': nextServer,
      '@/lib/auth': { getSession: async () => ({ id: '42', discordId: '123', username: 'Tester' }) },
      '@/lib/discord': {
        sendDmoSubmission: async (input) => {
          discordDeliveries.push(input);
          return { messageId: 'discord-message' };
        },
      },
      '@/lib/dmo-submissions': {
        createDmoSubmission: async (input) => {
          created.push(input);
          return { id: '99' };
        },
        submissionDateInLondon: () => '2026-11-09',
        updateDmoDiscordDelivery: async () => {},
      },
      '@/lib/te4CoachGroupServer': {
        syncPublicDmoSubmissionToTe4CoachGroup: async () => ({ status: 'skipped' }),
      },
      '@/lib/dmoSubmissionUpload': loadModule('lib/dmoSubmissionUpload.ts', {}),
    });
    const form = new FormData();
    form.set('tournament', 'Basel Open');
    form.set('round', 'Round of 16');
    form.set('player1', 'Squeaky');
    form.set('player2', 'maastodontee');
    form.set('player1Character', 'Roger Federer');
    form.set('player2Character', 'Roger Federer');
    form.set('coachShareUrl', 'https://replays.knowthew.net/m/3f9a1c07b2e4d5a6');
    form.set('publicShareConsent', 'true');
    form.set('coachGroupShareConsent', 'true');
    form.set('privateBlobPathname', 'dmo/42/d7c0201d-0c78-4b59-a876-82bba0d1f3ef-match.dmo');
    form.set('fileName', 'match.dmo');

    const response = await route.POST(new Request('https://forum.test/api/dmo-submissions', {
      method: 'POST',
      body: form,
    }));
    assert.equal(response.status, 201);
    assert.equal(blobReads, 1);
    assert.equal(created.length, 1);
    assert.equal(created[0].privateBlobPathname, 'dmo/42/d7c0201d-0c78-4b59-a876-82bba0d1f3ef-match.dmo');
    assert.equal(created[0].privateBlobContentType, 'application/octet-stream');
    assert.equal(created[0].fileName, 'match.dmo');
    assert.equal(created[0].player1Character, 'Roger Federer');
    assert.equal(created[0].player2Character, 'Roger Federer');
    assert.equal(created[0].publicShareConsent, true);
    assert.equal(created[0].coachGroupShareConsent, true);
    assert.equal(discordDeliveries[0].fileName, 'match.dmo');
  } finally {
    if (originalStoreId === undefined) delete process.env.MODERATION_BLOB_STORE_ID;
    else process.env.MODERATION_BLOB_STORE_ID = originalStoreId;
  }
});
