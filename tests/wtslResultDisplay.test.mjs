import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPublicWtslResults,
  buildWtslTournamentNameLookup,
  lookupWtslTournamentName,
} from '../lib/wtslResultDisplay.ts';

const officialSource = 'https://www.playwtsl.com/TE4/pages/all_results_fetch.php';

test('only completed WTSL results survive and profile rows win over feed aliases', () => {
  const coreRows = [
    {
      source_url: officialSource,
      tour: 'atp',
      tournament: 'Kinoshita Group Japan Open',
      round: 'Round of 32',
      p1: 'Gifu',
      p2: 'Sid',
      date: '06.10.2026',
      result: '7-5 6-1',
    },
    {
      source_url: officialSource,
      tour: 'atp',
      tournament: 'Tokyo ATP 500',
      p1: 'TBC',
      p2: 'Sid',
      date: '06.10.2026',
      result: '7-5 6-1',
    },
    {
      source_url: 'https://example.com/TE4-results-screenshot',
      tour: 'atp',
      tournament: 'Tokyo ATP 500',
      p1: 'Screenshot Player',
      p2: 'Sid',
      date: '06.10.2026',
      result: '7-5 6-1',
    },
    {
      source_url: officialSource,
      tour: 'atp',
      tournament: 'Tokyo ATP 500',
      p1: 'Scheduled Player',
      p2: 'Sid',
      date: '06.10.2026',
      result: 'Scheduled',
    },
    {
      source_url: officialSource,
      tour: 'atp',
      tournament: 'Osaka',
      round: 'R16',
      p1: 'Ace',
      p2: 'Bex',
      date: '05.10.2026',
      result: '6-2 6-4',
    },
  ];
  const profileRows = [
    {
      id: 42,
      tour: 'TE4',
      source_id: 'recent:official-profile-row',
      tournament_name: 'Tokyo',
      round_name: 'Round of 32',
      player_one_id: '20',
      player_one_name: 'Gifu',
      player_two_id: '4598',
      player_two_name: 'Sid',
      score: '7-5 6-1',
      played_at: '2026-10-06T00:00:00.000Z',
    },
    {
      id: 43,
      tour: 'TE4',
      source_id: 'import:screenshot-row',
      player_one_name: 'TBC',
      player_two_name: 'Sid',
      score: '7-5 6-1',
      played_at: '2026-10-06T00:00:00.000Z',
    },
  ];

  const results = buildPublicWtslResults(coreRows, profileRows, 'TE4', 10);

  assert.deepEqual(results.map((result) => result.id), [
    42,
    'wtsl-site:TE4|2026-10-05|ace|bex|2-6 4-6',
  ]);
  assert.equal(results[0].tournament_name, 'Tokyo');
  assert.equal(results[0].player_one_id, '20');
  assert.equal(results.some((result) => result.player_one_name === 'TBC'), false);
});

test('WTA core rows appear only on the WTA matches page', () => {
  const rows = [{
    source_url: 'https://playwtsl.com/TE4/pages/player_page.php',
    tour: 'wta',
    tournament: 'WTA Championships',
    round: 'Final',
    p1: 'Ava',
    p2: 'Bea',
    date: '2026-10-04',
    result: '6-4 6-3',
  }];

  assert.equal(buildPublicWtslResults(rows, [], 'TE4_(F)', 5).length, 1);
  assert.equal(buildPublicWtslResults(rows, [], 'TE4', 5).length, 0);
});

test('canonical tournament names resolve both forum keys and official event IDs', () => {
  const names = buildWtslTournamentNameLookup([{
    wtsl_tournament_key: 'te4-beijing-2026-te4',
    name: 'Beijing',
    official_url: 'https://www.playwtsl.com/TE4/pages/tournament.php?tournament=Beijing_2026_TE4',
  }]);

  assert.equal(lookupWtslTournamentName('te4-beijing-2026-te4', names), 'Beijing');
  assert.equal(lookupWtslTournamentName('Beijing_2026_TE4', names), 'Beijing');
  assert.equal(lookupWtslTournamentName('Tennis Elbow 4 (ATP Characters) - Beijing 2026', names), 'Beijing');
  assert.equal(lookupWtslTournamentName('missing-event', names), undefined);
});

test('official result dates preserve exact times and keep profile-only dates date-only', () => {
  const exactTime = '2026-10-06T18:42:00.000Z';
  const coreResult = buildPublicWtslResults([{
    source_url: officialSource,
    tour: 'atp',
    tournament: 'Beijing 2026 ATP Characters',
    p1: 'Ace',
    p2: 'Bex',
    date: '06.10.2026',
    played_at: exactTime,
    result: '6-4 6-3',
  }], [], 'TE4', 5);
  const profileResult = buildPublicWtslResults([], [{
    id: 42,
    tour: 'TE4',
    source_id: 'recent:official-profile-row',
    player_one_name: 'Ace',
    player_two_name: 'Bex',
    score: '6-4 6-3',
    played_at: '2026-10-06T00:00:00.000Z',
  }], 'TE4', 5);

  assert.equal(coreResult[0].played_at, exactTime);
  assert.equal(profileResult[0].played_at, '2026-10-06');
});
