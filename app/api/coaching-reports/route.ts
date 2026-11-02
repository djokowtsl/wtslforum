import { NextResponse } from 'next/server';
import { getPublishedCoachingReports } from '@/lib/coachingReports';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const reports = await getPublishedCoachingReports();
    return NextResponse.json(
      { reports },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('[coaching-reports] public list unavailable', {
      errorType: error instanceof Error ? error.name : 'UnknownError',
    });
    return NextResponse.json(
      { error: 'Public coaching reports are temporarily unavailable.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
