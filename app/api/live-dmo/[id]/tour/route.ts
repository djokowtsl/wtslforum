import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { isSameSiteMutation } from '@/lib/liveRequestSecurity';
import { sql } from '@/lib/db';

export const dynamic = 'force-dynamic';

const PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
};

const tourSchema = z.object({
  tour: z.enum(['ATP', 'WTA']),
}).strict();

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  if (!isSameSiteMutation(request)) {
    return NextResponse.json({ error: 'Request origin could not be verified.' }, { status: 403, headers: PRIVATE_HEADERS });
  }
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: 'Sign in to update a match tour.' }, { status: 401, headers: PRIVATE_HEADERS });
  }

  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'Broadcast not found.' }, { status: 404, headers: PRIVATE_HEADERS });
  }

  const body = await request.json().catch(() => null);
  const parsed = tourSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Choose ATP or WTA.' }, { status: 400, headers: PRIVATE_HEADERS });
  }

  try {
    const rows = await sql`
      UPDATE dmo_live_broadcasts
      SET payload=COALESCE(payload, '{}'::jsonb)
            || jsonb_build_object('isWta', ${parsed.data.tour === 'WTA'})
      WHERE id=${id}::uuid
        AND (owner_discord_id=${user.discordId} OR ${user.isAdmin})
        AND status IN ('live', 'ended')
        AND expires_at > NOW()
      RETURNING id
    `;
    if (!rows.length) {
      return NextResponse.json({ error: 'Broadcast not found or you cannot edit it.' }, { status: 404, headers: PRIVATE_HEADERS });
    }
    return NextResponse.json(
      { ok: true, isWta: parsed.data.tour === 'WTA' },
      { headers: PRIVATE_HEADERS },
    );
  } catch (error) {
    console.error('[live-broadcast] tour update failed', error instanceof Error ? error.name : 'UnknownError');
    return NextResponse.json({ error: 'The match tour could not be saved.' }, { status: 503, headers: PRIVATE_HEADERS });
  }
}
