import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deduplicateRedundantRoundFixtures,
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
