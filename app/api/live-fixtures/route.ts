import { NextResponse } from 'next/server';
import { loadPublicFixtures } from '@/lib/publicFeeds';
import { writeSiteSnapshot } from '@/lib/siteSnapshots';

export const dynamic = 'force-dynamic';
export const maxDuration = 180;

const noStore = { 'cache-control': 'no-store, max-age=0' };

export async function GET() {
  try {
    const payload = await loadPublicFixtures();
    const updatedAt = await writeSiteSnapshot('live-fixtures', payload, payload.checkedAt).catch((error) => {
      console.warn('[live-fixtures] Snapshot write failed', {
        errorType: error instanceof Error ? error.name : 'UnknownError',
      });
      return null;
    });

    return NextResponse.json(
      { ...payload, updatedAt },
      { headers: noStore },
    );
  } catch (error) {
    console.error('[live-fixtures] Feed unavailable', {
      errorType: error instanceof Error ? error.name : 'UnknownError',
    });
    return NextResponse.json(
      { error: 'live_fixture_feed_unavailable' },
      { status: 503, headers: noStore },
    );
  }
}
