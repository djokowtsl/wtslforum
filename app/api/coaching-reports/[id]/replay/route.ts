import { get } from '@vercel/blob';
import { NextResponse } from 'next/server';
import { getPublishedCoachingReplayPath } from '@/lib/coachingReports';
import { MAX_COACHING_REPLAY_BYTES } from '@/lib/coachingReportViewer';

export const dynamic = 'force-dynamic';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRIVATE_REPLAY_PATH = /^dmo-coaching-replays\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.json$/i;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: 'Coaching report not found.' }, { status: 404 });
  }

  try {
    const pathname = await getPublishedCoachingReplayPath(id);
    if (!pathname || !PRIVATE_REPLAY_PATH.test(pathname)) {
      return NextResponse.json(
        { error: 'Coaching report not found.' },
        { status: 404, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    const storeId = process.env.MODERATION_BLOB_STORE_ID;
    if (!storeId) {
      return NextResponse.json(
        { error: 'Replay storage is temporarily unavailable.' },
        { status: 503, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    const blob = await get(pathname, {
      access: 'private',
      storeId,
      useCache: false,
    });
    if (!blob || blob.statusCode !== 200 || !blob.stream) {
      return NextResponse.json(
        { error: 'The replay is temporarily unavailable.' },
        { status: 503, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    if (blob.blob.size > MAX_COACHING_REPLAY_BYTES) {
      return NextResponse.json(
        { error: 'The replay is larger than the supported viewing limit.' },
        { status: 413, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    return new Response(blob.stream, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    console.error('[coaching-reports] public replay unavailable', {
      errorType: error instanceof Error ? error.name : 'UnknownError',
    });
    return NextResponse.json(
      { error: 'The replay is temporarily unavailable.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
