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
  resolveFakePrefixForRankedPlayer,
} = module.exports;

const tournamentSource = readFileSync(new URL('../lib/liveBroadcastTournamentMatches.ts', import.meta.url), 'utf8');
const { code: tournamentCode } = require('next/dist/build/swc').transformSync(
  tournamentSource,
  {
    jsc: { parser: { syntax: 'typescript' }, target: 'es2022' },
    module: { type: 'commonjs' },
  },
);
const tournamentModule = { exports: {} };
new Function('require', 'module', 'exports', tournamentCode)((name) => {
  if (name === '@/lib/liveBroadcast') return module.exports;
  throw new Error(`Unexpected tournament-match dependency: ${name}`);
}, tournamentModule, tournamentModule.exports);
const {
  findOngoingTournamentMatchInText,
  isFreshTournamentMatchSnapshot,
  loadOngoingTournamentMatches,
  matchesOngoingTournament,
  parseChallongeOpenMatches,
  parseChallongeSvgUrl,
} = tournamentModule.exports;

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

test('fake-name prefixes resolve only when the cleaned name is ranked for that live match', () => {
  assert.equal(resolveFakePrefixForRankedPlayer('[Fake] Squeaky', ['Squeaky']), 'Squeaky');
  assert.equal(resolveFakePrefixForRankedPlayer('[Fake] Unranked', ['Squeaky']), '[Fake] Unranked');
  assert.equal(resolveFakePrefixForRankedPlayer('[.Squeaky', ['Squeaky']), 'Squeaky');
  assert.equal(
    resolveFakePrefixForRankedPlayer('[.Squeaky', ['Squeaky', 'Squea-ky']),
    '[.Squeaky',
  );

  const rankedMatch = {
    name: 'Squeaky vs Player Two',
    bestOf: 3,
    rankedPlayers: ['Squeaky', 'Player Two'],
  };
  const unrankedMatch = {
    name: 'Squeaky vs Player Two',
    bestOf: 3,
    rankedPlayers: [null, 'Player Two'],
  };
  assert.equal(findMatchingWtslLiveMatch(['[Fake] Squeaky', 'Player Two'], [rankedMatch]), rankedMatch);
  assert.equal(findMatchingWtslLiveMatch(['[.Squeaky', 'Player Two'], [rankedMatch]), rankedMatch);
  assert.equal(findMatchingWtslLiveMatch(['[Fake] Squeaky', 'Player Two'], [unrankedMatch]), null);
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

test('only open matches in an ongoing Challonge draw can establish tournament identity', () => {
  const svg = `<svg>
    <g class="match -open" data-match-id="1">
      <svg class="match--player" data-participant-id="1"><title>(3) Alpha (Character One)</title></svg>
      <svg class="match--player" data-participant-id="2"><title>Beta</title></svg>
    </g>
    <g class="match -complete" data-match-id="2">
      <svg class="match--player" data-participant-id="3"><title>Gamma</title></svg>
      <svg class="match--player" data-participant-id="4"><title>Delta</title></svg>
    </g>
  </svg>`;
  const matches = parseChallongeOpenMatches(svg, 'event-2026', 'TE4');

  assert.deepEqual(matches, [{
    tournamentId: 'event-2026',
    tour: 'TE4',
    first_name: 'Alpha',
    second_name: 'Beta',
  }]);
  assert.equal(matchesOngoingTournament(['Beta', 'Alpha'], matches), true);
  assert.equal(matchesOngoingTournament(['Gamma', 'Delta'], matches), false);
  assert.equal(
    findOngoingTournamentMatchInText('Alpha vs Beta — live now', matches)?.tournamentId,
    'event-2026',
  );
  assert.equal(findOngoingTournamentMatchInText('Alpha vs Gamma — live now', matches), null);
});

test('tournament snapshots must have a valid timestamp no more than 30 minutes old', () => {
  const now = Date.parse('2026-10-29T12:00:00.000Z');
  assert.equal(isFreshTournamentMatchSnapshot('2026-10-29T11:30:00.000Z', now), true);
  assert.equal(isFreshTournamentMatchSnapshot('2026-10-29T11:29:59.999Z', now), false);
  assert.equal(isFreshTournamentMatchSnapshot('2026-10-29T12:00:00.001Z', now), false);
  assert.equal(isFreshTournamentMatchSnapshot('invalid timestamp', now), false);
});

test('Challonge source extraction ignores unrelated iframes and rejects non-Challonge hosts', () => {
  assert.equal(
    parseChallongeSvgUrl(
      '<iframe src="https://video.example/embed"></iframe><iframe src="https://91d510368cb4170cd5ac3776.challonge.com/Guiyang_2026_TE4/module"></iframe>',
      'https://www.playwtsl.com/TE4/pages/tournament_page.php?tournament=Guiyang_2026_TE4',
    ),
    'https://91d510368cb4170cd5ac3776.challonge.com/Guiyang_2026_TE4.svg',
  );
  assert.equal(
    parseChallongeSvgUrl(
      '<iframe src="https://attacker.example/Guiyang_2026_TE4/module"></iframe>',
      'https://www.playwtsl.com/TE4/pages/tournament_page.php?tournament=Guiyang_2026_TE4',
    ),
    null,
  );
});

test('ongoing tournament snapshots combine official open fixtures and Challonge matches only', async () => {
  const requests = [];
  const matches = await loadOngoingTournamentMatches(
    [{
      tour: 'TE4',
      tournament_id: 'guangzhou-2026',
      first_name: 'Core Alpha',
      second_name: 'Core Beta',
    }],
    [
      {
        tour: 'TE4',
        status: 'ongoing',
        officialUrl: 'https://www.playwtsl.com/TE4/pages/tournament_page.php?tournament=guangzhou-2026',
      },
      {
        tour: 'TE4_(F)',
        status: 'upcoming',
        officialUrl: 'https://www.playwtsl.com/TE4_(F)/pages/tournament_page.php?tournament=upcoming-2026',
      },
    ],
    async (url) => {
      requests.push(String(url));
      if (String(url).includes('tournament_page.php')) {
        return new Response(
          '<iframe src="https://draw.challonge.com/guangzhou-2026/module"></iframe>',
          { status: 200 },
        );
      }
      return new Response(`<svg>
        <g class="match -open" data-match-id="3">
          <svg class="match--player"><title>Draw Alpha</title></svg>
          <svg class="match--player"><title>Draw Beta</title></svg>
        </g>
      </svg>`, { status: 200 });
    },
  );

  assert.equal(requests.length, 2);
  assert.deepEqual(matches, [
    {
      tournamentId: 'guangzhou-2026',
      tour: 'TE4',
      first_name: 'Core Alpha',
      second_name: 'Core Beta',
    },
    {
      tournamentId: 'guangzhou-2026',
      tour: 'TE4',
      first_name: 'Draw Alpha',
      second_name: 'Draw Beta',
    },
  ]);
});
