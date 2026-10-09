import { safe } from '@/lib/db';
import { fixturesBoard } from '@/lib/betting';
import { recentWtslSiteMatches } from '@/lib/stats';
import { getTournaments } from '@/lib/tournaments';
import {
  deduplicateBettingBoardFixtures,
  selectPublicOpenFixtures,
} from '@/lib/fixture-order';
import { buildWtslTournamentNameLookup } from '@/lib/wtslResultDisplay';
import type { PublicFixturePayload, PublicResultsPayload } from '@/lib/liveFeedTypes';
import type { TourCode } from '@/lib/wtsl';

export async function loadPublicResults(
  limit: number,
  tour: TourCode,
): Promise<PublicResultsPayload> {
  const [results, tournaments] = await Promise.all([
    recentWtslSiteMatches(limit, tour),
    safe(() => getTournaments(tour), [] as any[]),
  ]);

  return {
    results,
    tournamentNames: buildWtslTournamentNameLookup(tournaments),
    checkedAt: new Date().toISOString(),
  };
}

export async function loadPublicFixtures(): Promise<PublicFixturePayload> {
  const [board, atpTournaments, wtaTournaments] = await Promise.all([
    fixturesBoard(),
    safe(() => getTournaments('TE4'), [] as any[]),
    safe(() => getTournaments('TE4_(F)'), [] as any[]),
  ]);
  if (!Array.isArray(board?.open) || !Array.isArray(board?.recent_settled)) {
    throw new Error('WTSL Core returned an invalid fixtures payload');
  }

  const tournaments = [...atpTournaments, ...wtaTournaments];
  const normalizedBoard = {
    open: board.open,
    recent_settled: board.recent_settled,
  };

  return {
    bettingBoard: deduplicateBettingBoardFixtures(normalizedBoard, tournaments),
    publicOpen: selectPublicOpenFixtures(normalizedBoard.open, tournaments),
    checkedAt: new Date().toISOString(),
  };
}
