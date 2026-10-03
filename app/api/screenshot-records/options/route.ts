import { NextRequest, NextResponse } from 'next/server';
import {
  getScreenshotRecordFilterOptions,
  type ScreenshotTour,
} from '@/lib/screenshotRecords';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const tour = new URL(req.url).searchParams.get('tour');
  if (tour !== 'TE4' && tour !== 'TE4_(F)') {
    return NextResponse.json({ error: 'Invalid tour' }, { status: 400 });
  }

  try {
    const options = await getScreenshotRecordFilterOptions(tour as ScreenshotTour);
    return NextResponse.json(options, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  } catch {
    return NextResponse.json(
      { error: 'Screenshot record filter options could not be loaded' },
      { status: 500 },
    );
  }
}
