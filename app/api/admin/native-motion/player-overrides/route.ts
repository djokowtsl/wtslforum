import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { sql, transaction } from '@/lib/db';
import { isSameSiteMutation } from '@/lib/liveRequestSecurity';
import { isDmoReplayId } from '@/lib/dmoReplayLibrary';
import { fetchNativeMotionCatalog } from '@/lib/nativeMotionServer';
import {
  NATIVE_MOTION_STROKES,
  nativeMotionClipSupportsStroke,
  type NativeMotionPicks,
} from '@/lib/nativeMotionCatalogData';

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
const bodySchema = z.object({
  targetType: z.enum(['replay', 'manual']),
  targetId: z.string().min(1).max(40),
  playerClips: z.tuple([clipsSchema, clipsSchema]),
}).strict();
const uuidSchema = z.string().uuid();

export async function GET(request: Request) {
  if (!(await getSession())?.isAdmin) {
    return NextResponse.json({ error: 'Admin access required.' }, { status: 403, headers: HEADERS });
  }
  const search = new URL(request.url).searchParams.get('q')?.trim().slice(0, 100) ?? '';
  const pattern = search ? `%${search.replace(/[\\%_]/g, '\\$&')}%` : null;
  try {
    const [replays, broadcasts] = await Promise.all([
      sql`
        SELECT s.id::text AS id, s.player1, s.player2, s.player1_character, s.player2_character,
          s.tournament, s.round_name, s.submission_date::text AS submitted_at,
          (SELECT jsonb_object_agg(o.player_index, o.clips)
           FROM dmo_native_motion_player_overrides o WHERE o.submission_id = s.id) AS clip_overrides
        FROM dmo_submissions s
        WHERE s.hidden_at IS NULL
          AND s.private_blob_pathname LIKE 'dmo/%'
          AND LOWER(COALESCE(s.file_name, s.private_blob_pathname)) LIKE '%.dmo'
          AND (${pattern}::text IS NULL
            OR CONCAT_WS(' ',s.tournament,s.round_name,s.player1,s.player2) ILIKE ${pattern} ESCAPE E'\\\\')
        ORDER BY s.id DESC LIMIT 40
      `,
      sql`
        SELECT b.id::text AS id, b.payload->'players' AS players, b.started_at,
          (SELECT jsonb_object_agg(o.player_index, o.clips)
           FROM dmo_native_motion_player_overrides o WHERE o.broadcast_id = b.id) AS clip_overrides
        FROM dmo_live_broadcasts b
        WHERE b.status = 'live' AND b.expires_at > NOW() AND b.payload->>'mode' = 'manual'
        ORDER BY b.started_at DESC LIMIT 40
      `,
    ]);
    const targets = [
      ...replays.map((row) => ({
        id: String(row.id),
        type: 'replay' as const,
        players: [String(row.player1), String(row.player2)],
        characters: [row.player1_character || null, row.player2_character || null],
        label: [row.tournament, row.round_name, row.submitted_at].filter(Boolean).join(' · '),
        playerClips: [row.clip_overrides?.['0'] ?? {}, row.clip_overrides?.['1'] ?? {}],
      })),
      ...broadcasts.flatMap((row) => {
        if (!Array.isArray(row.players) || row.players.length !== 2
          || !row.players.every((name: unknown) => typeof name === 'string')) return [];
        return [{
          id: String(row.id),
          type: 'manual' as const,
          players: row.players,
          characters: [null, null],
          label: `Active manual stream · ${new Date(row.started_at).toISOString()}`,
          playerClips: [row.clip_overrides?.['0'] ?? {}, row.clip_overrides?.['1'] ?? {}],
        }];
      }),
    ];
    return NextResponse.json({ targets }, { headers: HEADERS });
  } catch (error) {
    console.error('[native-motion] match choices unavailable', error instanceof Error ? error.name : 'UnknownError');
    return NextResponse.json({ error: 'Match animation choices are unavailable. Apply the player override migration first.' }, {
      status: 503, headers: HEADERS,
    });
  }
}

export async function PUT(request: Request) {
  if (!isSameSiteMutation(request)) {
    return NextResponse.json({ error: 'Request origin could not be verified.' }, { status: 403, headers: HEADERS });
  }
  if (!(await getSession())?.isAdmin) {
    return NextResponse.json({ error: 'Admin access required.' }, { status: 403, headers: HEADERS });
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > 12000) {
    return NextResponse.json({ error: 'Animation choices are too large.' }, { status: 413, headers: HEADERS });
  }
  let raw: unknown;
  try { raw = JSON.parse(text); } catch {
    return NextResponse.json({ error: 'Invalid animation choices.' }, { status: 400, headers: HEADERS });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Choose one valid clip and confirm its source handedness for each selected stroke.' }, {
      status: 400, headers: HEADERS,
    });
  }
  const { targetType, targetId, playerClips } = parsed.data;
  if (targetType === 'replay' ? !isDmoReplayId(targetId) : !uuidSchema.safeParse(targetId).success) {
    return NextResponse.json({ error: 'Match not found.' }, { status: 404, headers: HEADERS });
  }
  try {
    const targets = targetType === 'replay'
      ? await sql`
        SELECT id FROM dmo_submissions WHERE id = ${targetId}::bigint AND hidden_at IS NULL
          AND private_blob_pathname LIKE 'dmo/%'
          AND LOWER(COALESCE(file_name, private_blob_pathname)) LIKE '%.dmo'
      `
      : await sql`
        SELECT id FROM dmo_live_broadcasts WHERE id = ${targetId}::uuid
          AND status = 'live' AND expires_at > NOW() AND payload->>'mode' = 'manual'
      `;
    if (!targets.length) {
      return NextResponse.json({ error: 'Replay or active manual stream not found.' }, { status: 404, headers: HEADERS });
    }
    if (playerClips.some((clips) => Object.keys(clips).length)) {
      const catalog = await fetchNativeMotionCatalog();
      for (const clips of playerClips) {
        for (const stroke of NATIVE_MOTION_STROKES) {
          const pick = clips[stroke];
          if (pick && !nativeMotionClipSupportsStroke(catalog.clips.find((clip) => clip.id === pick.clipId), stroke)) {
            return NextResponse.json({ error: `The selected ${stroke} clip has no compatible SDK contact marker.` }, {
              status: 400, headers: HEADERS,
            });
          }
        }
      }
    }
    await transaction((query) => {
      const commands = [targetType === 'replay'
        ? query`DELETE FROM dmo_native_motion_player_overrides WHERE submission_id = ${targetId}::bigint`
        : query`DELETE FROM dmo_native_motion_player_overrides WHERE broadcast_id = ${targetId}::uuid`];
      playerClips.forEach((clips: NativeMotionPicks, index) => {
        if (!Object.keys(clips).length) return;
        commands.push(targetType === 'replay'
          ? query`
            INSERT INTO dmo_native_motion_player_overrides (submission_id, player_index, clips)
            VALUES (${targetId}::bigint, ${index}, ${JSON.stringify(clips)}::jsonb)
          `
          : query`
            INSERT INTO dmo_native_motion_player_overrides (broadcast_id, player_index, clips)
            VALUES (${targetId}::uuid, ${index}, ${JSON.stringify(clips)}::jsonb)
          `);
      });
      return commands;
    });
    return NextResponse.json({ ok: true }, { headers: HEADERS });
  } catch (error) {
    console.error('[native-motion] match choices save failed', error instanceof Error ? error.name : 'UnknownError');
    return NextResponse.json({ error: 'Match animation choices could not be saved.' }, { status: 503, headers: HEADERS });
  }
}
