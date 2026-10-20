import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { sql } from '@/lib/db';

export const dynamic = 'force-dynamic';

const PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
};

export async function GET() {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: 'Sign in to watch live DMO broadcasts.' }, { status: 401, headers: PRIVATE_HEADERS });
  }
  try {
    const rows = await sql`
      WITH expired_rows AS (
        DELETE FROM dmo_live_broadcasts
        WHERE expires_at <= NOW()
        RETURNING id
      )
      SELECT id, status, payload, sequence, started_at, updated_at,
        (status='live' AND updated_at < NOW() - INTERVAL '10 seconds') AS stale
      FROM dmo_live_broadcasts
      WHERE (status='live' AND expires_at > NOW())
        OR (status='ended' AND expires_at > NOW())
      ORDER BY (status='live') DESC, started_at DESC
      LIMIT 1
    `;
    const row = rows[0];
    const payload = row?.payload && typeof row.payload === 'object' && !Array.isArray(row.payload)
      && Object.keys(row.payload).length
      ? row.payload
      : null;
    return NextResponse.json({
      broadcast: row ? {
        id: row.id,
        status: row.status,
        snapshot: payload,
        sequence: Number(row.sequence || 0),
        startedAt: new Date(row.started_at).toISOString(),
        updatedAt: new Date(row.updated_at).toISOString(),
        stale: Boolean(row.stale),
      } : null,
    }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    console.error('[dmo-live] viewer read failed', error instanceof Error ? error.name : 'UnknownError');
    return NextResponse.json(
      { error: 'Live DMO broadcasts are temporarily unavailable. The database migration may be pending.' },
      { status: 503, headers: PRIVATE_HEADERS },
    );
  }
}
