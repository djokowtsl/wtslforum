import { NextResponse } from 'next/server';
import { getLiveWtslMatches } from '@/lib/liveScores';
import { writeSiteSnapshot } from '@/lib/siteSnapshots';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const payload = await getLiveWtslMatches();
    const updatedAt = await writeSiteSnapshot('live-scores', payload, payload.checkedAt).catch((error) => {
      console.warn('[live-scores] Snapshot write failed', {
        errorType: error instanceof Error ? error.name : 'UnknownError',
      });
      return null;
    });
    return NextResponse.json({ ok: true, ...payload, updatedAt }, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  } catch (error) {
    console.error('[live-scores] server-list request failed', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ ok: false, error: 'Live scores are temporarily unavailable.' }, {
      status: 502,
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  }
}
