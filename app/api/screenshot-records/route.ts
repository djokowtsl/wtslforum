import { NextRequest, NextResponse } from 'next/server';
import {
  SCREENSHOT_METRIC_FIELDS,
  SCREENSHOT_REVIEW_STATUSES,
} from '@/lib/screenshotRecordFields';
import {
  getScreenshotRecordPage,
  type ScreenshotRecordFilters,
  type ScreenshotStatusFilter,
  type ScreenshotTour,
} from '@/lib/screenshotRecords';

export const dynamic = 'force-dynamic';

function textParam(params: URLSearchParams, name: string) {
  return (params.get(name) ?? '').trim().slice(0, 120);
}

function numberParam(params: URLSearchParams, name: string): number | null {
  const value = params.get(name);
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export async function GET(req: NextRequest) {
  const params = new URL(req.url).searchParams;
  const tourValue = params.get('tour');
  if (tourValue !== 'TE4' && tourValue !== 'TE4_(F)') {
    return NextResponse.json({ error: 'Invalid tour' }, { status: 400 });
  }
  const page = Number(params.get('page') ?? 1);
  if (!Number.isInteger(page) || page < 1 || page > 10000) {
    return NextResponse.json({ error: 'Invalid page' }, { status: 400 });
  }

  const yearValue = numberParam(params, 'year');
  if (yearValue !== null && (!Number.isInteger(yearValue) || yearValue < 1900 || yearValue > 2100)) {
    return NextResponse.json({ error: 'Invalid year' }, { status: 400 });
  }
  const statusValue = params.get('status') ?? 'any';
  const validStatuses = new Set<string>(['any', 'unflagged', ...SCREENSHOT_REVIEW_STATUSES]);
  if (!validStatuses.has(statusValue)) {
    return NextResponse.json({ error: 'Invalid review status' }, { status: 400 });
  }
  const metricValue = params.get('metric') ?? '';
  if (metricValue && !SCREENSHOT_METRIC_FIELDS.includes(
    metricValue as (typeof SCREENSHOT_METRIC_FIELDS)[number],
  )) {
    return NextResponse.json({ error: 'Invalid metric' }, { status: 400 });
  }
  const min = numberParam(params, 'min');
  const max = numberParam(params, 'max');
  if (
    (min !== null && !Number.isFinite(min))
    || (max !== null && !Number.isFinite(max))
    || (min !== null && max !== null && min > max)
    || ((min !== null || max !== null) && !metricValue)
  ) {
    return NextResponse.json({ error: 'Invalid metric range' }, { status: 400 });
  }

  const filters: ScreenshotRecordFilters = {
    tour: tourValue as ScreenshotTour,
    page,
    player: textParam(params, 'player'),
    opponent: textParam(params, 'opponent'),
    tournament: textParam(params, 'tournament'),
    search: textParam(params, 'q'),
    year: yearValue,
    status: statusValue as ScreenshotStatusFilter,
    metric: metricValue as ScreenshotRecordFilters['metric'],
    min,
    max,
  };

  try {
    const result = await getScreenshotRecordPage(filters);
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  } catch {
    return NextResponse.json({ error: 'Screenshot records could not be loaded' }, { status: 500 });
  }
}