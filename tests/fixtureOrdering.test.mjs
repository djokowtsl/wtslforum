import assert from 'node:assert/strict';
import test from 'node:test';
import { sortOpenFixturesByTournamentRecency } from '../lib/fixture-order.ts';

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