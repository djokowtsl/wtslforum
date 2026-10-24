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
const updateSchema = z.object({
  character: z.string().trim().min(1).max(120).nullable(),
}).strict();
const MAX_BODY_BYTES = 1_024;

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  if (!isSameSiteMutation(request)) {
    return NextResponse.json({ error: 'Request origin could not be verified.' }, { status: 403, headers: PRIVATE_HEADERS });
  }
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: 'Sign in to update your broadcast.' }, { status: 401, headers: PRIVATE_HEADERS });
  }

  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'Broadcast not found.' }, { status: 404, headers: PRIVATE_HEADERS });
  }

  let input: unknown;
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
      return NextResponse.json({ error: 'Broadcast character selection is too large.' }, { status: 413, headers: PRIVATE_HEADERS });
    }
    input = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: 'Invalid character selection.' }, { status: 400, headers: PRIVATE_HEADERS });
  }
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Choose a character from the WTSL roster or clear the selection.' }, { status: 400, headers: PRIVATE_HEADERS });
  }

  try {
    const rows = await sql`
      UPDATE dmo_live_broadcasts
      SET payload=COALESCE(payload, '{}'::jsonb)
            || jsonb_build_object('character', ${parsed.data.character}::text)
      WHERE id=${id}::uuid
        AND owner_discord_id=${user.discordId}
        AND status='live'
        AND expires_at > NOW()
      RETURNING id
    `;
    if (!rows.length) {
      return NextResponse.json({ error: 'Broadcast not found or no longer live.' }, { status: 404, headers: PRIVATE_HEADERS });
    }
    return NextResponse.json({ ok: true, character: parsed.data.character }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    console.error('[live-broadcast] character update failed', error instanceof Error ? error.name : 'UnknownError');
    return NextResponse.json({ error: 'Broadcast character could not be saved.' }, { status: 503, headers: PRIVATE_HEADERS });
  }
}
