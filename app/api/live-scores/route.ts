import { NextResponse } from 'next/server';
import { getLiveWtslMatches } from '@/lib/liveScores';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json({ ok: true, ...(await getLiveWtslMatches()) }, {
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
