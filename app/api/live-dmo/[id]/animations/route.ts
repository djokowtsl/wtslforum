import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { sql, transaction } from '@/lib/db';
import { isSameSiteMutation } from '@/lib/liveRequestSecurity';
import { fetchNativeMotionCatalog, fetchNativeMotionGestureCatalog } from '@/lib/nativeMotionServer';
import { isDmoCharacterGruntGroup } from '@/lib/dmoCharacterAppearance.mjs';
import {
  NATIVE_MOTION_STROKES,
  nativeMotionClipSupportsStroke,
  nativeMotionGestureClips,
  nativeMotionGestureClipIds,
  NATIVE_MOTION_GESTURE_SET_LIMIT,
} from '@/lib/nativeMotionCatalogData';

export const dynamic = 'force-dynamic';
const HEADERS = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
const MAX_BODY_BYTES = 24_000;
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
const gestureClipIdSchema = z.string().regex(/^[a-f0-9]+_[a-f0-9]+$/i).max(80);
// One animation, or a set the court plays in turn (`clipIds`, first = clipId).
const gesturePickSchema = z.object({
  clipId: gestureClipIdSchema,
  clipIds: z.array(gestureClipIdSchema).min(1).max(NATIVE_MOTION_GESTURE_SET_LIMIT).optional(),
}).strict();
const gesturesSchema = z.record(z.string().min(1).max(40), gesturePickSchema);
const gruntOverrideSchema = z.object({
  gruntGroup: z.string().max(80).nullable(),
}).strict();
const bodySchema = z.object({
  playerClips: z.tuple([clipsSchema.nullable(), clipsSchema.nullable()]),
  playerGestures: z.tuple([gesturesSchema.nullable(), gesturesSchema.nullable()]).optional(),
  playerGruntOverrides: z.tuple([
    gruntOverrideSchema.nullable(),
    gruntOverrideSchema.nullable(),
  ]).optional(),
  onlyIfEmpty: z.boolean().optional(),
}).strict();
type RouteContext = { params: Promise<{ id: string }> };
type Clips = z.infer<typeof clipsSchema>;
type Gestures = z.infer<typeof gesturesSchema>;

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
  return { error: null, ownerDiscordId: String(rows[0].owner_discord_id) };
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
    const gruntRows = await sql`
      SELECT player_index, grunt_group FROM dmo_character_grunt_match_overrides
      WHERE broadcast_id=${id}::uuid
    `;
    const playerClips: [Clips, Clips] = [{}, {}];
    const playerGestures: [Gestures, Gestures] = [{}, {}];
    for (const row of rows) {
      if (row.player_index !== 0 && row.player_index !== 1) continue;
      const stored = row.clips && typeof row.clips === 'object' ? row.clips : {};
      const { gestures, ...clips } = stored as Record<string, unknown>;
      playerClips[row.player_index as 0 | 1] = clips as Clips;
      playerGestures[row.player_index as 0 | 1] = gestures && typeof gestures === 'object'
        ? gestures as Gestures : {};
    }
    const playerGruntOverrides: [null | { gruntGroup: string | null }, null | { gruntGroup: string | null }] = [null, null];
    for (const row of gruntRows) {
      if (row.player_index === 0 || row.player_index === 1) {
        playerGruntOverrides[row.player_index] = { gruntGroup: row.grunt_group ?? null };
      }
    }
    return NextResponse.json(
      { playerClips, playerGestures, playerGruntOverrides, ownerDiscordId: managed.ownerDiscordId },
      { headers: HEADERS },
    );
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
  const { playerClips, playerGestures, playerGruntOverrides, onlyIfEmpty } = parsed.data;
  try {
    const managed = await ownedLiveStream(id);
    if (managed.error) return managed.error;
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
    if (playerGestures?.some((gestures) => gestures && Object.keys(gestures).length)) {
      let catalog;
      try {
        catalog = await fetchNativeMotionGestureCatalog();
      } catch (error) {
        console.error('Live gesture catalog validation is unavailable.', error);
        return NextResponse.json(
          { error: 'Gesture clips are not available from Core yet; existing motion is unchanged.' },
          { status: 503, headers: HEADERS },
        );
      }
      for (const gestures of playerGestures) {
        for (const [type, pick] of Object.entries(gestures ?? {})) {
          const available = new Set(nativeMotionGestureClips(catalog, type).map((clip) => clip.id));
          if (!nativeMotionGestureClipIds(pick).every((id) => available.has(id))) {
            return NextResponse.json(
              { error: 'The selected clip is not available for that gesture.' },
              { status: 400, headers: HEADERS },
            );
          }
        }
      }
    }
    for (const override of playerGruntOverrides ?? []) {
      if (override?.gruntGroup && !isDmoCharacterGruntGroup(override.gruntGroup)) {
        return NextResponse.json(
          { error: 'Choose a grunt bank from the available character profiles.' },
          { status: 400, headers: HEADERS },
        );
      }
    }
    await transaction((query) => {
      const commands: ReturnType<typeof query>[] = [];
      playerClips.forEach((clips, index) => {
        const gestures = playerGestures?.[index] ?? null;
        if (clips === null && gestures === null) return;
        // Restoring device defaults must never replace existing admin choices,
        // including choices saved between the initial GET and this transaction.
        if (onlyIfEmpty && clips !== null) {
          if (Object.keys(clips).length) commands.push(query`
            INSERT INTO dmo_native_motion_player_overrides (broadcast_id, player_index, clips)
            VALUES (${id}::uuid, ${index}, ${JSON.stringify(clips)}::jsonb)
            ON CONFLICT (broadcast_id, player_index) WHERE broadcast_id IS NOT NULL DO NOTHING
          `);
          return;
        }
        if (clips !== null) {
          const payload = {
            ...clips,
            ...(playerGestures?.[index] !== undefined ? { gestures: gestures ?? {} } : {}),
          };
          commands.push(query`
            INSERT INTO dmo_native_motion_player_overrides (broadcast_id, player_index, clips)
            VALUES (${id}::uuid, ${index}, ${JSON.stringify(payload)}::jsonb)
            ON CONFLICT (broadcast_id, player_index) WHERE broadcast_id IS NOT NULL DO UPDATE
            SET clips = CASE
              WHEN ${playerGestures?.[index] !== undefined} THEN EXCLUDED.clips
              ELSE jsonb_set(
                EXCLUDED.clips,
                '{gestures}',
                COALESCE(dmo_native_motion_player_overrides.clips->'gestures', '{}'::jsonb),
                true
              )
            END
          `);
        } else if (gestures !== null) {
          commands.push(query`
            INSERT INTO dmo_native_motion_player_overrides (broadcast_id, player_index, clips)
            VALUES (${id}::uuid, ${index}, ${JSON.stringify({ gestures })}::jsonb)
            ON CONFLICT (broadcast_id, player_index) WHERE broadcast_id IS NOT NULL DO UPDATE
            SET clips = CASE
              WHEN EXCLUDED.clips->'gestures' = '{}'::jsonb
                THEN dmo_native_motion_player_overrides.clips - 'gestures'
              ELSE jsonb_set(
                dmo_native_motion_player_overrides.clips,
                '{gestures}',
                EXCLUDED.clips->'gestures',
                true
              )
            END
          `);
        }
      });
      if (playerGruntOverrides) {
        commands.push(query`
          DELETE FROM dmo_character_grunt_match_overrides
          WHERE broadcast_id=${id}::uuid
        `);
        playerGruntOverrides.forEach((override, index) => {
          if (override === null) return;
          commands.push(query`
            INSERT INTO dmo_character_grunt_match_overrides
              (broadcast_id, player_index, grunt_group)
            VALUES (${id}::uuid, ${index}, ${override.gruntGroup}::text)
          `);
        });
      }
      return commands;
    });
    return NextResponse.json({ ok: true }, { headers: HEADERS });
  } catch (cause) {
    console.error('[live-broadcast] animation save failed', cause instanceof Error ? cause.name : 'UnknownError');
    return NextResponse.json({ error: 'Stream animations could not be saved.' }, { status: 503, headers: HEADERS });
  }
}
