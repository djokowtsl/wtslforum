import type { PublicFixtureFeeds, PublicResultsFeed } from '@/components/PublicLiveData';
import type { LiveScoresPayload } from '@/lib/liveFeedTypes';
import { getLiveWtslMatches } from '@/lib/liveScores';
import { loadPublicFixtures, loadPublicResults } from '@/lib/publicFeeds';
import { getPublicSiteSnapshot } from '@/lib/siteSnapshots';
import type { TourCode } from '@/lib/wtsl';

const emptyFixtures = {
  open: [],
  recent_settled: [],
};

export async function initialPublicFixtures(): Promise<PublicFixtureFeeds> {
  try {
    const snapshot = await getPublicSiteSnapshot<{
      bettingBoard: { open: any[]; recent_settled: any[] };
      publicOpen: any[];
    }>('live-fixtures', loadPublicFixtures);
    if (
      !snapshot
      || !Array.isArray(snapshot.payload.publicOpen)
      || !Array.isArray(snapshot.payload.bettingBoard?.open)
      || !Array.isArray(snapshot.payload.bettingBoard?.recent_settled)
    ) {
      throw new Error('Public fixtures snapshot is not available');
    }

    return {
      status: 'ready',
      publicOpen: snapshot.payload.publicOpen,
      bettingBoard: snapshot.payload.bettingBoard,
      checkedAt: snapshot.checkedAt,
      updatedAt: snapshot.updatedAt,
      source: snapshot.source ?? 'snapshot',
    };
  } catch {
    return {
      status: 'unavailable',
      publicOpen: [],
      bettingBoard: emptyFixtures,
      source: null,
      refreshing: false,
    };
  }
}

export async function initialPublicResults(
  limit: number,
  tour: TourCode,
): Promise<PublicResultsFeed> {
  try {
    const snapshot = await getPublicSiteSnapshot<{
      results: any[];
      tournamentNames: Record<string, string>;
    }>(`live-results:${tour}`, () => loadPublicResults(60, tour));
    if (
      !snapshot
      || !Array.isArray(snapshot.payload.results)
      || !snapshot.payload.tournamentNames
      || typeof snapshot.payload.tournamentNames !== 'object'
    ) {
      throw new Error('Public results snapshot is not available');
    }

    return {
      status: 'ready',
      results: snapshot.payload.results.slice(0, limit),
      tournamentNames: snapshot.payload.tournamentNames,
      checkedAt: snapshot.checkedAt,
      updatedAt: snapshot.updatedAt,
      source: snapshot.source ?? 'snapshot',
    };
  } catch {
    return {
      status: 'unavailable',
      results: [],
      tournamentNames: {},
      source: null,
    };
  }
}

export async function initialLiveScores(): Promise<{
  payload: LiveScoresPayload | null;
  source: 'snapshot' | 'live' | null;
}> {
  try {
    const snapshot = await getPublicSiteSnapshot<LiveScoresPayload>('live-scores', getLiveWtslMatches);
    if (
      !snapshot
      || !Array.isArray(snapshot.payload.matches)
      || typeof snapshot.payload.checkedAt !== 'string'
    ) {
      return { payload: null, source: null };
    }
    return {
      payload: { ...snapshot.payload, checkedAt: snapshot.checkedAt, updatedAt: snapshot.updatedAt },
      source: snapshot.source ?? 'snapshot',
    };
  } catch {
    return { payload: null, source: null };
  }
}
