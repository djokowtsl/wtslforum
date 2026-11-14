import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { sql, transaction } from '@/lib/db';
import { isSameSiteMutation } from '@/lib/liveRequestSecurity';
import { fetchNativeMotionCatalog } from '@/lib/nativeMotionServer';
import {
  NATIVE_MOTION_STROKES,
  nativeMotionClipSupportsStroke,
} from '@/lib/nativeMotionCatalogData';

export const dynamic = 'force-dynamic';
const HEADERS = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
const MAX_BODY_BYTES = 8_000;
const pickSchema = z.object({
  clipId: z.string().regex(/^[a-f0-9]+_[a-f0-9]+$/i).max(80),
  sourceHandedness: z.enum(['left', 'right']),
}).strict();
const clipsSchema = z.object({
  forehand: pickSchema.optional(),
  backhand: pickSchema.optional(),
  serve: pickSchema.optional(),
  'slice-forehand': pickSchema.optional(),
  'slice-backhand': pickSchema.optional(),
}).strict();
const bodySchema = z.object({
  playerClips: z.tuple([clipsSchema.nullable(), clipsSchema.nullable()]),
  onlyIfEmpty: z.boolean().optional(),
}).strict();
type RouteContext = { params: Promise<{ id: string }> };
type Clips = z.infer<typeof clipsSchema>;

async function ownedLiveStream(id: string) {
  const user = await getSession();
  if (!user) {
    return { error: NextResponse.json({ error: 'Sign in to manage your stream.' }, { status: 401, headers: HEADERS }) };
  }
  if (!z.string().uuid().safeParse(id).success) {
    return { error: NextResponse.json({ error: 'Stream not found.' }, { status: 404, headers: HEADERS }) };
  }
  const rows = await sql`
    SELECT owner_discord_id, payload FROM dmo_live_broadcasts
    WHERE id=${id}::uuid AND status='live' AND expires_at > NOW()
    LIMIT 1
  `;
  if (!rows.length) {
    return { error: NextResponse.json({ error: 'Stream not found or no longer live.' }, { status: 404, headers: HEADERS }) };
  }
  if (String(rows[0].owner_discord_id) !== user.discordId && !user.isAdmin) {
    return { error: NextResponse.json(
      { error: 'Only the streamer or an admin can choose this stream’s animations.' },
      { status: 403, headers: HEADERS },
    ) };
  }
  const payload = rows[0].payload && typeof rows[0].payload === 'object'
    ? rows[0].payload as Record<string, unknown> : {};
  if (payload.hasDmo !== true) {
    return { error: NextResponse.json({ error: 'This stream has no DMO court.' }, { status: 404, headers: HEADERS }) };
  }
  const characters = Array.isArray(payload.playerCharacters) && payload.playerCharacters.length === 2
    ? payload.playerCharacters : [payload.character, payload.opponentCharacter];
  return { error: null, characters, ownerDiscordId: String(rows[0].owner_discord_id) };
}

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const managed = await ownedLiveStream(id);
    if (managed.error) return managed.error;
    const rows = await sql`
      SELECT player_index, clips FROM dmo_native_motion_player_overrides
      WHERE broadcast_id=${id}::uuid
    `;
    const playerClips: [Clips, Clips] = [{}, {}];
    for (const row of rows) {
      if (row.player_index === 0 || row.player_index === 1) playerClips[row.player_index as 0 | 1] = row.clips ?? {};
    }
    return NextResponse.json({ playerClips, ownerDiscordId: managed.ownerDiscordId }, { headers: HEADERS });
  } catch (cause) {
    console.error('[live-broadcast] animation lookup failed', cause instanceof Error ? cause.name : 'UnknownError');
    return NextResponse.json({ error: 'Stream animations are temporarily unavailable.' }, { status: 503, headers: HEADERS });
  }
}

export async function PUT(request: Request, context: RouteContext) {
  if (!isSameSiteMutation(request)) {
    return NextResponse.json({ error: 'Request origin could not be verified.' }, { status: 403, headers: HEADERS });
  }
  const { id } = await context.params;
  let raw: unknown;
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
      return NextResponse.json({ error: 'Animation choices are too large.' }, { status: 413, headers: HEADERS });
    }
    raw = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: 'Invalid animation choices.' }, { status: 400, headers: HEADERS });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Choose one valid clip and its original handedness for each selected stroke.' },
      { status: 400, headers: HEADERS },
    );
  }
  const { playerClips, onlyIfEmpty } = parsed.data;
  try {
    const managed = await ownedLiveStream(id);
    if (managed.error) return managed.error;
    if (playerClips.some((clips, index) => clips !== null && String(managed.characters?.[index] ?? '').trim())) {
      return NextResponse.json(
        { error: 'These choices are only for players with no roster character. Leave roster players unchanged.' },
        { status: 409, headers: HEADERS },
      );
    }
    if (playerClips.some((clips) => clips && Object.keys(clips).length)) {
      const catalog = await fetchNativeMotionCatalog();
      for (const clips of playerClips) {
        for (const stroke of NATIVE_MOTION_STROKES) {
          const pick = clips?.[stroke];
          if (pick && !nativeMotionClipSupportsStroke(catalog.clips.find((clip) => clip.id === pick.clipId), stroke)) {
            return NextResponse.json(
              { error: `The selected ${stroke} clip can't be used for that stroke.` },
              { status: 400, headers: HEADERS },
            );
          }
        }
      }
    }
    await transaction((query) => {
      const commands: ReturnType<typeof query>[] = [];
      playerClips.forEach((clips, index) => {
        if (clips === null) return;
        // Restoring device defaults must never replace existing admin choices,
        // including choices saved between the initial GET and this transaction.
        if (onlyIfEmpty) {
          if (Object.keys(clips).length) commands.push(query`
            INSERT INTO dmo_native_motion_player_overrides (broadcast_id, player_index, clips)
            VALUES (${id}::uuid, ${index}, ${JSON.stringify(clips)}::jsonb)
            ON CONFLICT (broadcast_id, player_index) WHERE broadcast_id IS NOT NULL DO NOTHING
          `);
          return;
        }
        commands.push(query`
          DELETE FROM dmo_native_motion_player_overrides
          WHERE broadcast_id=${id}::uuid AND player_index=${index}
        `);
        if (Object.keys(clips).length) commands.push(query`
          INSERT INTO dmo_native_motion_player_overrides (broadcast_id, player_index, clips)
          VALUES (${id}::uuid, ${index}, ${JSON.stringify(clips)}::jsonb)
        `);
      });
      return commands;
    });
    return NextResponse.json({ ok: true }, { headers: HEADERS });
  } catch (cause) {
    console.error('[live-broadcast] animation save failed', cause instanceof Error ? cause.name : 'UnknownError');
    return NextResponse.json({ error: 'Stream animations could not be saved.' }, { status: 503, headers: HEADERS });
  }
}
