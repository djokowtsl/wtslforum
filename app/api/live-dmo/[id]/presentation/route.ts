import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { isSameSiteMutation } from '@/lib/liveRequestSecurity';
import { sql } from '@/lib/db';

export const dynamic = 'force-dynamic';

const HEADERS = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
};
const handednessPair = z.tuple([z.enum(['left', 'right']), z.enum(['left', 'right'])]);
const strokeStyle = z.object({
  forehand: z.enum(['one', 'two']),
  backhand: z.enum(['one', 'two']),
}).strict();
const strokeStylesPair = z.tuple([strokeStyle, strokeStyle]);
const bodySchema = z.object({
  handedness: handednessPair.optional(),
  strokeStyles: strokeStylesPair.optional(),
}).strict().refine((body) => body.handedness !== undefined || body.strokeStyles !== undefined);
const MAX_BODY_BYTES = 4_000;

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  if (!isSameSiteMutation(request)) {
    return NextResponse.json({ error: 'Request origin could not be verified.' }, {
      status: 403,
      headers: HEADERS,
    });
  }
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: 'Sign in to update live presentation settings.' }, {
      status: 401,
      headers: HEADERS,
    });
  }
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'Broadcast not found.' }, { status: 404, headers: HEADERS });
  }

  let raw: unknown;
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
      return NextResponse.json({ error: 'Presentation settings are too large.' }, {
        status: 413,
        headers: HEADERS,
      });
    }
    raw = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: 'Invalid presentation settings.' }, {
      status: 400,
      headers: HEADERS,
    });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Choose valid handedness and stroke settings.' }, {
      status: 400,
      headers: HEADERS,
    });
  }

  try {
    const rows = await sql`
      SELECT owner_discord_id, payload
      FROM dmo_live_broadcasts
      WHERE id=${id}::uuid AND status='live' AND expires_at > NOW()
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) {
      return NextResponse.json({ error: 'This broadcast is no longer live.' }, {
        status: 404,
        headers: HEADERS,
      });
    }
    if (String(row.owner_discord_id) !== user.discordId && !user.isAdmin) {
      return NextResponse.json({ error: 'Only the stream owner or an admin can change live presentation settings.' }, {
        status: 403,
        headers: HEADERS,
      });
    }
    const payload = row.payload && typeof row.payload === 'object'
      ? row.payload as Record<string, unknown>
      : {};
    if (payload.hasDmo !== true) {
      return NextResponse.json({ error: 'This broadcast does not have a DMO court.' }, {
        status: 404,
        headers: HEADERS,
      });
    }

    const settings = parsed.data;
    const updated = await sql`
      UPDATE dmo_live_broadcasts
      SET payload = COALESCE(payload, '{}'::jsonb)
        || jsonb_build_object(
          'presentationOverrides',
          COALESCE(payload->'presentationOverrides', '{}'::jsonb)
            || ${JSON.stringify(settings)}::jsonb
        )
        || CASE
          WHEN jsonb_typeof(payload->'snapshot') = 'object'
            THEN jsonb_build_object(
              'snapshot',
              payload->'snapshot' || ${JSON.stringify(settings)}::jsonb
            )
          ELSE '{}'::jsonb
        END
      WHERE id=${id}::uuid AND status='live' AND expires_at > NOW()
      RETURNING id
    `;
    if (!updated.length) {
      return NextResponse.json({ error: 'This broadcast is no longer live.' }, {
        status: 404,
        headers: HEADERS,
      });
    }
    return NextResponse.json({ ok: true }, { headers: HEADERS });
  } catch (error) {
    console.error('[live-broadcast] presentation update failed', error instanceof Error ? error.name : 'UnknownError');
    return NextResponse.json({ error: 'Live presentation settings could not be saved.' }, {
      status: 503,
      headers: HEADERS,
    });
  }
}
