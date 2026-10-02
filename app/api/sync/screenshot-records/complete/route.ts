import { NextRequest, NextResponse } from 'next/server';
import {
  activateScreenshotRecordSnapshot,
  type ScreenshotTour,
} from '@/lib/screenshotRecords';

export const dynamic = 'force-dynamic';

function authorized(req: NextRequest) {
  const secret = process.env.WTSL_SYNC_SECRET;
  if (secret && req.headers.get('x-wtsl-sync-secret') === secret) return true;
  const cronSecret = process.env.CRON_SECRET;
  return Boolean(cronSecret && req.headers.get('authorization') === `Bearer ${cronSecret}`);
}

function isTour(value: unknown): value is ScreenshotTour {
  return value === 'TE4' || value === 'TE4_(F)';
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!isTour(body?.tour)) return NextResponse.json({ error: 'Invalid tour' }, { status: 400 });
  if (typeof body?.syncId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(body.syncId)) {
    return NextResponse.json({ error: 'Invalid sync ID' }, { status: 400 });
  }
  const expectedRows = Number(body?.expectedRows);
  if (!Number.isInteger(expectedRows) || expectedRows < 1 || expectedRows > 25000) {
    return NextResponse.json({ error: 'Invalid expected row count' }, { status: 400 });
  }

  try {
    const activeRows = await activateScreenshotRecordSnapshot(
      body.tour,
      body.syncId,
      expectedRows,
    );
    if (activeRows !== expectedRows) {
      return NextResponse.json({ error: 'Screenshot snapshot was not activated' }, { status: 409 });
    }
    return NextResponse.json({ ok: true, activeRows });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Screenshot snapshot is incomplete')) {
      return NextResponse.json({ error: 'Screenshot snapshot is incomplete' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Screenshot snapshot could not be activated' }, { status: 500 });
  }
}