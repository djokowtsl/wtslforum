import { NextRequest, NextResponse } from 'next/server';
import { isWtslSyncAuthorized } from '@/lib/wtslSyncAuth';
import { TOURS, type TourCode } from '@/lib/wtsl';
import { fetchWTSLWtaMatchResults } from '@/lib/wtslSeasonResults';
import { getLiveWtslMatches } from '@/lib/liveScores';
import { loadPublicFixtures, loadPublicResults } from '@/lib/publicFeeds';
import { writeSiteSnapshot } from '@/lib/siteSnapshots';
import { wtslCore } from '@/lib/wtsl-core';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

type SnapshotJob = {
  key: string;
  load: () => Promise<unknown>;
  count: (payload: any) => number;
};

function requireArray(payload: unknown, key: string): unknown[] {
  if (!Array.isArray(payload)) throw new Error(`Invalid ${key} snapshot payload`);
  return payload;
}

export async function GET(request: NextRequest) {
  if (!isWtslSyncAuthorized(request.headers)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const year = new Date().getUTCFullYear();
  const tours = TOURS.map((tour) => tour.code);
  const jobs: SnapshotJob[] = [
    ...tours.map((tour: TourCode) => ({
      key: `live-results:${tour}`,
      load: () => loadPublicResults(60, tour),
      count: (payload: any) => payload.results.length,
    })),
    {
      key: 'live-fixtures',
      load: loadPublicFixtures,
      count: (payload: any) => payload.bettingBoard.open.length + payload.bettingBoard.recent_settled.length,
    },
    {
      key: 'live-scores',
      load: getLiveWtslMatches,
      count: (payload: any) => payload.matches.length,
    },
    {
      key: `dashboard-season-results:${year}`,
      // Keep full history for calendar-year highlights, including leap years.
      // Core only accepts days=1..365; public recent-results boards still use 30.
      load: async () => requireArray(await wtslCore.results(), 'dashboard season results'),
      count: (payload: any) => payload.length,
    },
    {
      key: `dashboard-wta-season-results:${year}`,
      load: async () => requireArray(await fetchWTSLWtaMatchResults(), 'dashboard WTA season results'),
      count: (payload: any) => payload.length,
    },
    {
      key: 'predictions-leaderboard',
      load: async () => requireArray(await wtslCore.predictionsLeaderboard(100), 'predictions leaderboard'),
      count: (payload: any) => payload.length,
    },
  ];

  const outcomes = await Promise.all(jobs.map(async (job) => {
    try {
      const payload = await job.load() as any;
      const checkedAt = typeof payload?.checkedAt === 'string'
        ? payload.checkedAt
        : new Date().toISOString();
      await writeSiteSnapshot(job.key, payload, checkedAt);
      return { key: job.key, ok: true, count: job.count(payload), checkedAt };
    } catch (error) {
      console.error('[public-page-snapshots] Refresh failed', {
        key: job.key,
        errorType: error instanceof Error ? error.name : 'UnknownError',
      });
      return { key: job.key, ok: false };
    }
  }));

  const failed = outcomes.filter((outcome) => !outcome.ok);
  if (failed.length === 0) {
    const completedAt = new Date().toISOString();
    try {
      await writeSiteSnapshot(
        'public-page-snapshot-sync-status',
        { completedAt },
        completedAt,
      );
    } catch (error) {
      console.error('[public-page-snapshots] Could not record successful refresh time', {
        errorType: error instanceof Error ? error.name : 'UnknownError',
      });
      failed.push({ key: 'public-page-snapshot-sync-status', ok: false });
    }
  }

  return NextResponse.json(
    { ok: failed.length === 0, refreshed: outcomes.filter((outcome) => outcome.ok), failed },
    { status: failed.length === 0 ? 200 : 503 },
  );
}
