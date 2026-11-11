import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { isSameSiteMutation } from '@/lib/liveRequestSecurity';
import { sql, transaction } from '@/lib/db';

export const dynamic = 'force-dynamic';

const PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
};
const requestSchema = z.object({
  broadcastId: z.string().uuid(),
  profileKeys: z.tuple([z.string().max(100).nullable(), z.string().max(100).nullable()]),
}).strict();

export async function PUT(request: Request) {
  if (!isSameSiteMutation(request)) {
    return NextResponse.json({ error: 'Request origin could not be verified.' }, { status: 403, headers: PRIVATE_HEADERS });
  }
  const user = await getSession();
  if (!user?.isAdmin) {
    return NextResponse.json({ error: 'Admin access required.' }, { status: 403, headers: PRIVATE_HEADERS });
  }
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > 2_000) {
    return NextResponse.json({ error: 'Manual stream override is too large.' }, { status: 413, headers: PRIVATE_HEADERS });
  }
  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid manual stream override.' }, { status: 400, headers: PRIVATE_HEADERS });
  }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Choose a saved profile for each override.' }, { status: 400, headers: PRIVATE_HEADERS });
  }
  const { broadcastId, profileKeys } = parsed.data;
  try {
    const live = await sql`
      SELECT id FROM dmo_live_broadcasts
      WHERE id = ${broadcastId}::uuid
        AND status = 'live'
        AND expires_at > NOW()
        AND payload->>'mode' = 'manual'
    `;
    if (!live.length) {
      return NextResponse.json({ error: 'Manual stream is no longer live.' }, { status: 404, headers: PRIVATE_HEADERS });
    }
    const keys = [...new Set(profileKeys.filter((key): key is string => key !== null))];
    if (keys.length) {
      const existing = await sql`
        SELECT profile_key, automatic_fallback FROM dmo_native_motion_profiles
        WHERE profile_key IN (${keys[0] ?? ''}, ${keys[1] ?? ''})
      `;
      if (existing.some((row) => row.automatic_fallback)) {
        return NextResponse.json(
          { error: 'Automatic fallback profiles can only be used by automatic streams.' },
          { status: 400, headers: PRIVATE_HEADERS },
        );
      }
      if (new Set(existing.map((row) => row.profile_key)).size !== keys.length) {
        return NextResponse.json({ error: 'One of the selected animation profiles no longer exists.' }, { status: 400, headers: PRIVATE_HEADERS });
      }
    }
    await transaction((query) => {
      const commands = [
        query`DELETE FROM dmo_native_motion_stream_overrides WHERE broadcast_id = ${broadcastId}::uuid`,
      ];
      const values = profileKeys.flatMap((profileKey, playerIndex) => (
        profileKey ? [[playerIndex, profileKey] as const] : []
      ));
      if (values.length === 1) {
        const [playerIndex, profileKey] = values[0];
        commands.push(query`
          INSERT INTO dmo_native_motion_stream_overrides
            (broadcast_id, player_index, profile_key, updated_at)
          VALUES (${broadcastId}::uuid, ${playerIndex}, ${profileKey}, NOW())
        `);
      } else if (values.length === 2) {
        const [[firstIndex, firstKey], [secondIndex, secondKey]] = values;
        commands.push(query`
          INSERT INTO dmo_native_motion_stream_overrides
            (broadcast_id, player_index, profile_key, updated_at)
          VALUES
            (${broadcastId}::uuid, ${firstIndex}, ${firstKey}, NOW()),
            (${broadcastId}::uuid, ${secondIndex}, ${secondKey}, NOW())
        `);
      }
      return commands;
    });
    return NextResponse.json({ ok: true }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    console.error('[native-motion] manual override save failed', error instanceof Error ? error.name : 'UnknownError');
    return NextResponse.json({ error: 'Manual stream override could not be saved.' }, { status: 503, headers: PRIVATE_HEADERS });
  }
}
