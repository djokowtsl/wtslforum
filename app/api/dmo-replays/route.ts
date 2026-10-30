import { NextResponse } from 'next/server';
import { isDmoReplayId, listPublicDmoReplays } from '@/lib/dmoReplayLibrary';

export const dynamic = 'force-dynamic';

const PUBLIC_HEADERS = {
  'Cache-Control': 'public, max-age=30, stale-while-revalidate=120',
  'X-Content-Type-Options': 'nosniff',
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const rawCursor = url.searchParams.get('cursor');
  const cursor = rawCursor && isDmoReplayId(rawCursor) ? rawCursor : null;
  const query = url.searchParams.get('q')?.trim().slice(0, 100) ?? '';
  if (rawCursor && !cursor) {
    return NextResponse.json({ error: 'Invalid replay page.' }, { status: 400, headers: PUBLIC_HEADERS });
  }

  try {
    const page = await listPublicDmoReplays({ cursor, query });
    return NextResponse.json(page, { headers: PUBLIC_HEADERS });
  } catch {
    return NextResponse.json(
      { error: 'Match replays are temporarily unavailable.' },
      { status: 503, headers: { ...PUBLIC_HEADERS, 'Cache-Control': 'no-store' } },
    );
  }
}
