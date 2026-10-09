import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cleanOpenFixtures,
  deduplicateBettingBoardFixtures,
  deduplicateRedundantRoundFixtures,
  selectPublicOpenFixtures,
  sortOpenFixturesByTournamentRecency,
} from '../lib/fixture-order.ts';

const tournamentUrl = (id) =>
  `https://www.playwtsl.com/TE4/pages/tournament_page.php?tournament=${id}`;

test('newer ongoing tournament fixtures are grouped ahead of older events', () => {
  const fixtures = [
    { key: 'beijing', tour: 'TE4', tournament_id: 'Beijing_2026_TE4', tournament: 'Beijing (R16)' },
    { key: 'tokyo-1', tour: 'TE4', tournament_id: 'Tokyo_2026_TE4', tournament: 'Tokyo (R32)' },
    { key: 'seoul-1', tour: 'TE4', tournament_id: 'Seoul_2026_TE4', tournament: 'Seoul (R16)' },
    { key: 'tokyo-2', tour: 'TE4', tournament_id: 'Tokyo_2026_TE4', tournament: 'Tokyo (R64)' },
  ];
  const tournaments = [
    { tour: 'TE4', name: 'Beijing', status: 'ongoing', start_date: '2026-09-28', official_url: tournamentUrl('Beijing_2026_TE4') },
    { tour: 'TE4', name: 'Tokyo', status: 'ongoing', start_date: '2026-10-03', official_url: tournamentUrl('Tokyo_2026_TE4') },
    { tour: 'TE4', name: 'Seoul', status: 'ongoing', start_date: '2026-10-03', official_url: tournamentUrl('Seoul_2026_TE4') },
  ];

  assert.deepEqual(
    sortOpenFixturesByTournamentRecency(fixtures, tournaments).map((fixture) => fixture.key),
    ['tokyo-1', 'tokyo-2', 'seoul-1', 'beijing'],
  );
});

test('upcoming and completed events follow ongoing events, with tours kept separate', () => {
  const fixtures = [
    { key: 'completed', tour: 'TE4', tournament_id: 'Old_2026_TE4', tournament: 'Old Event (F)' },
    { key: 'wta', tour: 'TE4_(F)', tournament_id: 'Tokyo_2026_TE4', tournament: 'Tokyo (R32)' },
    { key: 'upcoming', tour: 'TE4', tournament_id: 'Next_2026_TE4', tournament: 'Next Event (R32)' },
    { key: 'ongoing', tour: 'TE4', tournament_id: 'Tokyo_2026_TE4', tournament: 'Tokyo (R32)' },
  ];
  const tournaments = [
    { tour: 'TE4', name: 'Old Event', status: 'completed', start_date: '2026-08-01', official_url: tournamentUrl('Old_2026_TE4') },
    { tour: 'TE4', name: 'Next Event', status: 'upcoming', start_date: '2026-10-12', official_url: tournamentUrl('Next_2026_TE4') },
    { tour: 'TE4', name: 'Tokyo', status: 'ongoing', start_date: '2026-10-03', official_url: tournamentUrl('Tokyo_2026_TE4') },
  ];

  assert.deepEqual(
    sortOpenFixturesByTournamentRecency(fixtures, tournaments).map((fixture) => fixture.key),
    ['ongoing', 'upcoming', 'completed', 'wta'],
  );
});

test('fixture event name is a fallback when its tournament ID is missing', () => {
  const fixtures = [
    { key: 'old', tour: 'TE4', tournament: 'Beijing (R16)' },
    { key: 'new', tour: 'TE4', tournament: 'Sapporo (QF)' },
  ];
  const tournaments = [
    { tour: 'TE4', name: 'Beijing', status: 'ongoing', start_date: '2026-09-28', official_url: tournamentUrl('Beijing_2026_TE4') },
    { tour: 'TE4', name: 'Sapporo', status: 'ongoing', start_date: '2026-10-03', official_url: tournamentUrl('Sapporo_2026_TE4') },
  ];

  assert.deepEqual(
    sortOpenFixturesByTournamentRecency(fixtures, tournaments).map((fixture) => fixture.key),
    ['new', 'old'],
  );
});

test('removes only a stale nested round label for the same official fixture', () => {
  const deadline = 'Tue, 06 Oct 2026 22:59:00 GMT';
  const fixtures = [
    {
      key: 'stale',
      tour: 'TE4',
      tournament_id: 'Tokyo_2026_TE4',
      tournament: 'Tokyo (R64) (R32)',
      first_id: '20',
      second_id: '4598',
      round_deadline: deadline,
    },
    {
      key: 'current',
      tour: 'TE4',
      tournament_id: 'Tokyo_2026_TE4',
      tournament: 'Tokyo (R32)',
      first_id: '20',
      second_id: '4598',
      round_deadline: deadline,
    },
    {
      key: 'other-event',
      tour: 'TE4',
      tournament_id: 'Tokyo_Challenger_2026_TE4',
      tournament: 'Tokyo (R64) (R32)',
      first_id: '20',
      second_id: '4598',
      round_deadline: deadline,
    },
    {
      key: 'different-deadline',
      tour: 'TE4',
      tournament_id: 'Tokyo_2026_TE4',
      tournament: 'Tokyo (R64) (R32)',
      first_id: '20',
      second_id: '4598',
      round_deadline: 'Wed, 07 Oct 2026 22:59:00 GMT',
    },
  ];
  const tournaments = [
    {
      tour: 'TE4',
      name: 'Tokyo',
      official_url: tournamentUrl('Tokyo_2026_TE4'),
    },
    {
      tour: 'TE4',
      name: 'Tokyo',
      official_url: tournamentUrl('Tokyo_Challenger_2026_TE4'),
    },
  ];

  assert.deepEqual(
    deduplicateRedundantRoundFixtures(fixtures, tournaments).map((fixture) => fixture.key),
    ['current', 'other-event', 'different-deadline'],
  );
});

test('keeps same-event fixtures with equally specific round labels', () => {
  const fixtures = [
    {
      key: 'round-of-64',
      tour: 'TE4',
      tournament_id: 'Tokyo_2026_TE4',
      tournament: 'Tokyo (R64)',
      first_id: '20',
      second_id: '4598',
      round_deadline: 'Tue, 06 Oct 2026 22:59:00 GMT',
    },
    {
      key: 'round-of-32',
      tour: 'TE4',
      tournament_id: 'Tokyo_2026_TE4',
      tournament: 'Tokyo (R32)',
      first_id: '20',
      second_id: '4598',
      round_deadline: 'Tue, 06 Oct 2026 22:59:00 GMT',
    },
  ];
  const tournaments = [
    {
      tour: 'TE4',
      name: 'Tokyo',
      official_url: tournamentUrl('Tokyo_2026_TE4'),
    },
  ];

  assert.deepEqual(
    deduplicateRedundantRoundFixtures(fixtures, tournaments).map((fixture) => fixture.key),
    ['round-of-64', 'round-of-32'],
  );
});

test('removes a short event alias only for the same official fixture', () => {
  const deadline = 'Wed, 07 Oct 2026 22:59:00 GMT';
  const fixtures = [
    {
      key: 'short-alias',
      tour: 'TE4',
      tournament_id: 'Sapporo_2026_TE4',
      tournament: 'Sapporo (QF)',
      first_id: 'player-a',
      second_id: 'player-b',
      round_deadline: deadline,
    },
    {
      key: 'canonical',
      tour: 'TE4',
      tournament_id: 'Sapporo_2026_TE4',
      tournament: 'Sapporo Futures · Outdoor Hard (QF)',
      first_id: 'player-a',
      second_id: 'player-b',
      round_deadline: deadline,
    },
    {
      key: 'different-event-id',
      tour: 'TE4',
      tournament_id: 'Sapporo_2026_TE4_ALT',
      tournament: 'Sapporo Futures · Outdoor Hard (QF)',
      first_id: 'player-a',
      second_id: 'player-b',
      round_deadline: deadline,
    },
    {
      key: 'different-pair',
      tour: 'TE4',
      tournament_id: 'Sapporo_2026_TE4',
      tournament: 'Sapporo Futures · Outdoor Hard (QF)',
      first_id: 'player-a',
      second_id: 'player-c',
      round_deadline: deadline,
    },
    {
      key: 'different-deadline',
      tour: 'TE4',
      tournament_id: 'Sapporo_2026_TE4',
      tournament: 'Sapporo Futures · Outdoor Hard (QF)',
      first_id: 'player-a',
      second_id: 'player-b',
      round_deadline: 'Thu, 08 Oct 2026 22:59:00 GMT',
    },
    {
      key: 'different-round',
      tour: 'TE4',
      tournament_id: 'Sapporo_2026_TE4',
      tournament: 'Sapporo Futures · Outdoor Hard (SF)',
      first_id: 'player-a',
      second_id: 'player-b',
      round_deadline: deadline,
    },
  ];
  const tournaments = [
    {
      tour: 'TE4',
      name: 'Sapporo Futures · Outdoor Hard',
      official_url: tournamentUrl('Sapporo_2026_TE4'),
    },
    {
      tour: 'TE4',
      name: 'Sapporo Futures · Outdoor Hard',
      official_url: tournamentUrl('Sapporo_2026_TE4_ALT'),
    },
  ];

  assert.deepEqual(
    deduplicateRedundantRoundFixtures(fixtures, tournaments).map((fixture) => fixture.key),
    [
      'canonical',
      'different-event-id',
      'different-pair',
      'different-deadline',
      'different-round',
    ],
  );
});

test('deduplicates descriptive fixture names against a shorter official tournament name', () => {
  const deadline = 'Wed, 07 Oct 2026 22:59:00 GMT';
  const fixtures = [
    { key: 'pastore-short', tour: 'TE4', tournament_id: 'Sapporo_2026_TE4', tournament: 'Sapporo (QF)', first_id: '4656', second_id: '1291', round_deadline: deadline },
    { key: 'pastore-descriptive', tour: 'TE4', tournament_id: 'Sapporo_2026_TE4', tournament: 'Sapporo Futures · Outdoor Hard (QF)', first_id: '4656', second_id: '1291', round_deadline: deadline },
    { key: 'ziggy-short', tour: 'TE4', tournament_id: 'Sapporo_2026_TE4', tournament: 'Sapporo (QF)', first_id: '4653', second_id: '4647', round_deadline: deadline },
    { key: 'ziggy-descriptive', tour: 'TE4', tournament_id: 'Sapporo_2026_TE4', tournament: 'Sapporo Futures · Outdoor Hard (QF)', first_id: '4653', second_id: '4647', round_deadline: deadline },
    { key: 'different-event-id', tour: 'TE4', tournament_id: 'Sapporo_2026_TE4_ALT', tournament: 'Sapporo Futures · Outdoor Hard (QF)', first_id: '4656', second_id: '1291', round_deadline: deadline },
  ];
  const tournaments = [
    { tour: 'TE4', name: 'Sapporo', official_url: tournamentUrl('Sapporo_2026_TE4') },
    { tour: 'TE4', name: 'Sapporo', official_url: tournamentUrl('Sapporo_2026_TE4_ALT') },
  ];

  assert.deepEqual(
    deduplicateRedundantRoundFixtures(fixtures, tournaments).map((fixture) => fixture.key),
    ['pastore-short', 'ziggy-short', 'different-event-id'],
  );
});
test('deduplicates redundant aliases in both betting board sections', () => {
  const deadline = 'Wed, 07 Oct 2026 22:59:00 GMT';
  const fixture = (key, tournament, first_id, second_id, round_deadline = deadline) => ({
    key,
    tour: 'TE4',
    tournament_id: 'Sapporo_2026_TE4',
    tournament,
    first_id,
    first_name: `Player ${first_id}`,
    second_id,
    second_name: `Player ${second_id}`,
    round_deadline,
  });
  const board = deduplicateBettingBoardFixtures({
    open: [
      fixture('open-short', 'Sapporo (QF)', 'a', 'b'),
      fixture('open-descriptive', 'Sapporo Futures · Outdoor Hard (QF)', 'a', 'b'),
      fixture('open-different-pair', 'Sapporo Futures · Outdoor Hard (QF)', 'a', 'c'),
    ],
    recent_settled: [
      fixture('settled-short', 'Sapporo (SF)', 'd', 'e'),
      fixture('settled-descriptive', 'Sapporo Futures · Outdoor Hard (SF)', 'd', 'e'),
      fixture('settled-different-deadline', 'Sapporo Futures · Outdoor Hard (SF)', 'd', 'e', 'Thu, 08 Oct 2026 22:59:00 GMT'),
    ],
  }, [
    { tour: 'TE4', name: 'Sapporo', official_url: tournamentUrl('Sapporo_2026_TE4') },
  ]);

  assert.deepEqual(board.open.map((item) => item.key), ['open-short', 'open-different-pair']);
  assert.deepEqual(board.recent_settled.map((item) => item.key), ['settled-short', 'settled-different-deadline']);
});

test('open and settled betting cards use the official tournament name and keep the round', () => {
  const officialTournament = {
    tour: 'TE4',
    name: 'Seoul Challenger 125 · Outdoor Hard',
    official_url: tournamentUrl('Seoul_2026_TE4'),
  };
  const fixture = (key, tournament, firstId, secondId) => ({
    key,
    tour: 'TE4',
    tournament_id: 'Seoul_2026_TE4',
    tournament,
    first_id: firstId,
    first_name: `Player ${firstId}`,
    second_id: secondId,
    second_name: `Player ${secondId}`,
    round_deadline: 'Wed, 07 Oct 2026 22:59:00 GMT',
  });
  const board = deduplicateBettingBoardFixtures({
    open: [fixture('open', 'SEOUL CHALLENGER 125 · OUTDOOR HARD (R16)', 'a', 'b')],
    recent_settled: [fixture('settled', 'SEOUL (R16)', 'c', 'd')],
  }, [officialTournament]);

  assert.equal(board.open[0].tournament, 'Seoul Challenger 125 · Outdoor Hard (R16)');
  assert.equal(board.recent_settled[0].tournament, 'Seoul Challenger 125 · Outdoor Hard (R16)');
});

test('home, matches, and betting share only confirmed WTSL fixtures', () => {
  const fixtures = [
    { key: 'bad-placeholder', tour: 'TE4', tournament_id: 'Tokyo_2026_TE4', tournament: 'Tokyo (R32)', first_id: null, first_name: 'TBC', second_id: '4598', second_name: 'Sid' },
    { key: 'official-pair', tour: 'TE4', tournament_id: 'Tokyo_2026_TE4', tournament: 'Tokyo (R32)', first_id: '20', first_name: 'Gifu', second_id: '4598', second_name: 'Sid' },
  ];
  const tournaments = [
    { tour: 'TE4', name: 'Tokyo', status: 'ongoing', official_url: tournamentUrl('Tokyo_2026_TE4') },
  ];

  assert.deepEqual(
    cleanOpenFixtures(fixtures, tournaments).map((fixture) => fixture.key),
    ['official-pair'],
  );
  assert.deepEqual(
    selectPublicOpenFixtures(fixtures, tournaments).map((fixture) => fixture.key),
    ['official-pair'],
  );
  assert.deepEqual(
    deduplicateBettingBoardFixtures({ open: fixtures }, tournaments).open.map((fixture) => fixture.key),
    ['official-pair'],
  );
});
