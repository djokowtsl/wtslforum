import { get } from '@vercel/blob';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { sql } from '@/lib/db';
import { isLiveDmoReplayPath } from '@/lib/liveDmoStorage';

export const dynamic = 'force-dynamic';

const PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
};

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: 'Sign in to watch this replay.' }, { status: 401, headers: PRIVATE_HEADERS });
  }

  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'Replay not found.' }, { status: 404, headers: PRIVATE_HEADERS });
  }

  const rows = await sql`
    SELECT payload
    FROM dmo_live_broadcasts
    WHERE id=${id}::uuid AND status IN ('live', 'ended') AND expires_at > NOW()
  `;
  const stored = rows[0]?.payload && typeof rows[0].payload === 'object' && !Array.isArray(rows[0].payload)
    ? rows[0].payload as Record<string, unknown>
    : {};
  const pathname = stored.replayDataPath;
  if (stored.mode !== 'manual' || stored.replay !== true || !isLiveDmoReplayPath(pathname)) {
    return NextResponse.json({ error: 'Replay data is not available.' }, { status: 404, headers: PRIVATE_HEADERS });
  }

  const storeId = process.env.MODERATION_BLOB_STORE_ID;
  if (!storeId) {
    return NextResponse.json({ error: 'Private replay storage is not configured.' }, { status: 503, headers: PRIVATE_HEADERS });
  }

  try {
    const blob = await get(pathname, { access: 'private', storeId, useCache: false });
    if (!blob || blob.statusCode !== 200 || !blob.stream) {
      return NextResponse.json({ error: 'Replay data could not be found.' }, { status: 404, headers: PRIVATE_HEADERS });
    }
    return new Response(blob.stream, {
      headers: {
        ...PRIVATE_HEADERS,
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': String(blob.blob.size),
      },
    });
  } catch {
    return NextResponse.json({ error: 'Replay data is temporarily unavailable.' }, { status: 503, headers: PRIVATE_HEADERS });
  }
}
