import { NextRequest, NextResponse } from 'next/server';
import { replaceBotRatingLeaderboard } from '@/lib/botRatingLeaderboards';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-wtsl-sync-secret');
  if (!process.env.WTSL_SYNC_SECRET || secret !== process.env.WTSL_SYNC_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  const tour = body?.tour;
  const rows = body?.rows;
  if (!['TE4', 'TE4_(F)'].includes(tour) || !Array.isArray(rows)) {
    return NextResponse.json({ error: 'Expected a supported tour and rows array' }, { status: 400 });
  }
  const result = await replaceBotRatingLeaderboard(tour, rows);
  return NextResponse.json({ ok: true, ...result });
}
