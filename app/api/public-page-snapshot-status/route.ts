import { NextResponse } from 'next/server';
import { readSiteSnapshot } from '@/lib/siteSnapshots';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const snapshot = await readSiteSnapshot<{ completedAt: string }>(
      'public-page-snapshot-sync-status',
    );
    return NextResponse.json(
      { lastRefreshedAt: snapshot?.payload.completedAt ?? null },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } },
    );
  } catch {
    return NextResponse.json(
      { lastRefreshedAt: null },
      { status: 503, headers: { 'Cache-Control': 'no-store, max-age=0' } },
    );
  }
}
