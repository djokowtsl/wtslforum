import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { isSameSiteMutation } from '@/lib/liveRequestSecurity';
import { sql, transaction } from '@/lib/db';
import { fetchNativeMotionCatalog } from '@/lib/nativeMotionServer';
import {
  NATIVE_MOTION_STROKES,
  nativeMotionClipSupportsStroke,
  type NativeMotionPicks,
} from '@/lib/nativeMotionCatalogData';
import { isDmoCharacterGruntGroup } from '@/lib/dmoCharacterAppearance.mjs';

export const dynamic = 'force-dynamic';
const HEADERS = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
const pickSchema = z.object({
  clipId: z.string().regex(/^[a-f0-9]+_[a-f0-9]+$/i).max(80),
  sourceHandedness: z.enum(['left', 'right']),
}).strict();
const clipsSchema = z.object({
  forehand: pickSchema.optional(),
  backhand: pickSchema.optional(),
  serve: pickSchema.optional(),
}).strict();
const gruntOverrideSchema = z.object({
  gruntGroup: z.string().max(80).nullable(),
}).strict();
const bodySchema = z.object({
  broadcastId: z.string().uuid(),
  playerClips: z.tuple([clipsSchema, clipsSchema]),
  playerGruntOverrides: z.tuple([
    gruntOverrideSchema.nullable(),
    gruntOverrideSchema.nullable(),
  ]).optional(),
}).strict();

async function findManagedBroadcast(broadcastId: string, user: { discordId: string; isAdmin: boolean }) {
  const rows = await sql`
    SELECT owner_discord_id, payload
    FROM dmo_live_broadcasts
    WHERE id=${broadcastId}::uuid AND status='live' AND expires_at > NOW()
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return { error: 'This broadcast is no longer live.', status: 404 as const };
  if (String(row.owner_discord_id) !== user.discordId && !user.isAdmin) {
    return { error: 'Only the stream owner or an admin can change live animations.', status: 403 as const };
  }
  const payload = row.payload && typeof row.payload === 'object'
    ? row.payload as Record<string, unknown>
    : {};
  if (payload.hasDmo !== true) {
    return { error: 'This broadcast does not have a DMO court.', status: 404 as const };
  }
  return { row, payload };
}

export async function GET(request: Request) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: 'Sign in to change live animations.' }, { status: 401, headers: HEADERS });
  }
  const broadcastId = new URL(request.url).searchParams.get('broadcastId') ?? '';
  if (!z.string().uuid().safeParse(broadcastId).success) {
    return NextResponse.json({ error: 'Broadcast not found.' }, { status: 404, headers: HEADERS });
  }
  try {
    const managed = await findManagedBroadcast(broadcastId, user);
    if ('error' in managed) {
      return NextResponse.json({ error: managed.error }, { status: managed.status, headers: HEADERS });
    }
    const rows = await sql`
      SELECT player_index, clips
      FROM dmo_native_motion_player_overrides
      WHERE broadcast_id=${broadcastId}::uuid
      ORDER BY player_index
    `;
    const gruntRows = await sql`
      SELECT player_index, grunt_group
      FROM dmo_character_grunt_match_overrides
      WHERE broadcast_id=${broadcastId}::uuid
      ORDER BY player_index
    `;
    const playerClips: [NativeMotionPicks, NativeMotionPicks] = [{}, {}];
    for (const row of rows) {
      if (row.player_index === 0 || row.player_index === 1) {
        playerClips[row.player_index] = row.clips ?? {};
      }
    }
    const playerGruntOverrides: [null | { gruntGroup: string | null }, null | { gruntGroup: string | null }] = [null, null];
    for (const row of gruntRows) {
      if (row.player_index === 0 || row.player_index === 1) {
        playerGruntOverrides[row.player_index] = { gruntGroup: row.grunt_group ?? null };
      }
    }
    const playerCharacters = Array.isArray(managed.payload.playerCharacters)
      && managed.payload.playerCharacters.length === 2
      ? managed.payload.playerCharacters.map((name) => (
        typeof name === 'string' && name.trim() ? name.trim() : null
      ))
      : [typeof managed.payload.character === 'string' ? managed.payload.character : null, null];
    return NextResponse.json({ playerClips, playerCharacters, playerGruntOverrides }, { headers: HEADERS });
  } catch (error) {
    console.error('[native-motion] live override read failed', error instanceof Error ? error.name : 'UnknownError');
    return NextResponse.json({ error: 'Live animation choices are unavailable.' }, { status: 503, headers: HEADERS });
  }
}

export async function PUT(request: Request) {
  if (!isSameSiteMutation(request)) {
    return NextResponse.json({ error: 'Request origin could not be verified.' }, { status: 403, headers: HEADERS });
  }
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: 'Sign in to change live animations.' }, { status: 401, headers: HEADERS });
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > 12_000) {
    return NextResponse.json({ error: 'Animation choices are too large.' }, { status: 413, headers: HEADERS });
  }
  let raw: unknown;
  try { raw = JSON.parse(text); } catch {
    return NextResponse.json({ error: 'Invalid animation choices.' }, { status: 400, headers: HEADERS });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Choose a valid clip and handedness for each selected stroke.' }, {
      status: 400,
      headers: HEADERS,
    });
  }
  const { broadcastId, playerClips, playerGruntOverrides } = parsed.data;
  try {
    const managed = await findManagedBroadcast(broadcastId, user);
    if ('error' in managed) {
      return NextResponse.json({ error: managed.error }, { status: managed.status, headers: HEADERS });
    }
    if (playerClips.some((clips) => Object.keys(clips).length)) {
      const catalog = await fetchNativeMotionCatalog();
      for (const clips of playerClips) {
        for (const stroke of NATIVE_MOTION_STROKES) {
          const pick = clips[stroke];
          if (!pick) continue;
          const clip = catalog.clips.find((candidate) => candidate.id === pick.clipId);
          if (!nativeMotionClipSupportsStroke(clip, stroke) || clip?.hidden) {
            return NextResponse.json({ error: `The selected ${stroke} clip is unavailable or incompatible.` }, {
              status: 400,
              headers: HEADERS,
            });
          }
        }
      }
    }
    for (const override of playerGruntOverrides ?? []) {
      if (override?.gruntGroup && !isDmoCharacterGruntGroup(override.gruntGroup)) {
        return NextResponse.json({ error: 'Choose a grunt bank from the available character profiles.' }, {
          status: 400,
          headers: HEADERS,
        });
      }
    }
    await transaction((query) => {
      const commands = [
        query`DELETE FROM dmo_native_motion_player_overrides WHERE broadcast_id=${broadcastId}::uuid`,
      ];
      playerClips.forEach((clips: NativeMotionPicks, playerIndex: number) => {
        if (!Object.keys(clips).length) return;
        commands.push(query`
          INSERT INTO dmo_native_motion_player_overrides (broadcast_id, player_index, clips)
          VALUES (${broadcastId}::uuid, ${playerIndex}, ${JSON.stringify(clips)}::jsonb)
        `);
      });
      if (playerGruntOverrides) {
        commands.push(query`
          DELETE FROM dmo_character_grunt_match_overrides
          WHERE broadcast_id=${broadcastId}::uuid
        `);
        playerGruntOverrides.forEach((override, playerIndex) => {
          if (override === null) return;
          commands.push(query`
            INSERT INTO dmo_character_grunt_match_overrides
              (broadcast_id, player_index, grunt_group)
            VALUES (${broadcastId}::uuid, ${playerIndex}, ${override.gruntGroup}::text)
          `);
        });
      }
      return commands;
    });
    return NextResponse.json({ ok: true }, { headers: HEADERS });
  } catch (error) {
    console.error('[native-motion] live override save failed', error instanceof Error ? error.name : 'UnknownError');
    return NextResponse.json({ error: 'Live animation choices could not be saved.' }, { status: 503, headers: HEADERS });
  }
}
