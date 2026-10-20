import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { isSameSiteMutation } from '@/lib/liveRequestSecurity';
import { sql } from '@/lib/db';

export const dynamic = 'force-dynamic';

const PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
};

export async function POST(request: Request) {
  if (!isSameSiteMutation(request)) {
    return NextResponse.json({ error: 'Request origin could not be verified.' }, { status: 403, headers: PRIVATE_HEADERS });
  }
  const user = await getSession();
  if (!user?.isAdmin) {
    return NextResponse.json({ error: 'Admin access required.' }, { status: 403, headers: PRIVATE_HEADERS });
  }

  try {
    await sql`DELETE FROM dmo_live_broadcasts WHERE expires_at <= NOW()`;
    const active = await sql`
      SELECT id FROM dmo_live_broadcasts
      WHERE status='live' AND expires_at > NOW()
      ORDER BY started_at DESC LIMIT 1
    `;
    if (active.length) {
      return NextResponse.json(
        { error: 'A live DMO broadcast is already active.' },
        { status: 409, headers: PRIVATE_HEADERS },
      );
    }

    const id = randomUUID();
    await sql`
      INSERT INTO dmo_live_broadcasts
        (id, owner_discord_id, status, sequence, payload, started_at, updated_at, expires_at)
      VALUES
        (${id}::uuid, ${user.discordId}, 'live', 0, NULL, NOW(), NOW(), NOW() + INTERVAL '45 seconds')
    `;
    return NextResponse.json({ id }, { status: 201, headers: PRIVATE_HEADERS });
  } catch (error) {
    console.error('[dmo-live] broadcast start failed', error instanceof Error ? error.name : 'UnknownError');
    return NextResponse.json(
      { error: 'Live DMO broadcasting is temporarily unavailable. The database migration may be pending.' },
      { status: 503, headers: PRIVATE_HEADERS },
    );
  }
}
