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
    return NextResponse.json({ error: 'Sign in to manage your live stream.' }, { status: 401, headers: PRIVATE_HEADERS });
  }

  try {
    const rows = await sql`
      SELECT id, payload
      FROM dmo_live_broadcasts
      WHERE owner_discord_id=${user.discordId}
        AND status='live'
        AND expires_at > NOW()
        AND payload->>'hasDmo'='false'
        AND payload->'stream' IS NOT NULL
      ORDER BY started_at DESC
      LIMIT 1
    `;
    const row = rows[0];
    return NextResponse.json({
      broadcast: row
        ? {
          id: String(row.id),
          stream: row.payload?.stream ?? null,
          ...(typeof row.payload?.character === 'string'
            ? { character: row.payload.character }
            : {}),
        }
        : null,
    }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    console.error('[live-broadcast] owner stream lookup failed', error instanceof Error ? error.name : 'UnknownError');
    return NextResponse.json({ error: 'Live stream status is temporarily unavailable.' }, { status: 503, headers: PRIVATE_HEADERS });
  }
}
