import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { isSameSiteMutation } from '@/lib/liveRequestSecurity';
import { sql } from '@/lib/db';
import {
  NATIVE_MOTION_AUTOMATIC_PROFILE_KEY,
  NATIVE_MOTION_STROKES,
  deduplicateNativeMotionCharacterNames,
  nativeMotionClipSupportsStroke,
  nativeMotionProfileKey,
  type NativeMotionPicks,
  type NativeMotionProfile,
  type NativeMotionStroke,
} from '@/lib/nativeMotionCatalogData';
import { fetchNativeMotionCatalog } from '@/lib/nativeMotionServer';

export const dynamic = 'force-dynamic';

const PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
};
const clipIdSchema = z.string().regex(/^[a-f0-9]+_[a-f0-9]+$/i).max(80);
const handSchema = z.enum(['left', 'right']);
const bodySchema = z.object({
  characterName: z.string().trim().min(1).max(100).optional(),
  automaticFallback: z.boolean(),
  clips: z.object({
    forehand: z.object({ clipId: clipIdSchema, sourceHandedness: handSchema }).nullable().optional(),
    backhand: z.object({ clipId: clipIdSchema, sourceHandedness: handSchema }).nullable().optional(),
    serve: z.object({ clipId: clipIdSchema, sourceHandedness: handSchema }).nullable().optional(),
    'slice-forehand': z.object({ clipId: clipIdSchema, sourceHandedness: handSchema }).nullable().optional(),
    'slice-backhand': z.object({ clipId: clipIdSchema, sourceHandedness: handSchema }).nullable().optional(),
  }).strict(),
}).strict();

type ProfileRow = {
  profile_key: string;
  character_name: string;
  automatic_fallback: boolean;
  clips: NativeMotionPicks;
  updated_at: Date | string;
};

type CharacterRow = { character_name: string };

function toProfile(row: ProfileRow): NativeMotionProfile {
  return {
    profileKey: row.profile_key,
    characterName: row.character_name,
    automaticFallback: Boolean(row.automatic_fallback),
    clips: row.clips ?? {},
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

async function requireAdmin() {
  const user = await getSession();
  return user?.isAdmin ? user : null;
}

export async function GET() {
  const user = await requireAdmin();
  if (!user) {
    return NextResponse.json({ error: 'Admin access required.' }, { status: 403, headers: PRIVATE_HEADERS });
  }
  try {
    const [rows, characterRows] = await Promise.all([
      sql`
        SELECT profile_key, character_name, automatic_fallback, clips, updated_at
        FROM dmo_native_motion_profiles
        ORDER BY automatic_fallback DESC, character_name ASC
      ` as Promise<ProfileRow[]>,
      sql`
        WITH recent_submissions AS (
          SELECT player1_character, player2_character
          FROM dmo_submissions
          WHERE hidden_at IS NULL
          ORDER BY id DESC
          LIMIT 500
        ), replay_characters AS (
          SELECT NULLIF(BTRIM(player1_character), '') AS character_name
          FROM recent_submissions
          UNION ALL
          SELECT NULLIF(BTRIM(player2_character), '') AS character_name
          FROM recent_submissions
        )
        SELECT DISTINCT character_name
        FROM replay_characters
        WHERE character_name IS NOT NULL
        ORDER BY character_name
        LIMIT 200
      ` as Promise<CharacterRow[]>,
    ]);
    const characters = deduplicateNativeMotionCharacterNames(
      characterRows.map((row) => row.character_name),
    );
    return NextResponse.json(
      { profiles: rows.map(toProfile), characters },
      { headers: PRIVATE_HEADERS },
    );
  } catch (error) {
    console.error('[native-motion] profile list failed', error instanceof Error ? error.name : 'UnknownError');
    return NextResponse.json(
      { error: 'Motion profile storage is unavailable. Apply the Forum migration, then retry.' },
      { status: 503, headers: PRIVATE_HEADERS },
    );
  }
}

export async function PUT(request: Request) {
  if (!isSameSiteMutation(request)) {
    return NextResponse.json({ error: 'Request origin could not be verified.' }, { status: 403, headers: PRIVATE_HEADERS });
  }
  const user = await requireAdmin();
  if (!user) {
    return NextResponse.json({ error: 'Admin access required.' }, { status: 403, headers: PRIVATE_HEADERS });
  }
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > 12_000) {
    return NextResponse.json({ error: 'Motion profile is too large.' }, { status: 413, headers: PRIVATE_HEADERS });
  }
  const bodyText = await request.text();
  if (new TextEncoder().encode(bodyText).byteLength > 12_000) {
    return NextResponse.json({ error: 'Motion profile is too large.' }, { status: 413, headers: PRIVATE_HEADERS });
  }
  let raw: unknown;
  try {
    raw = JSON.parse(bodyText);
  } catch {
    return NextResponse.json({ error: 'Invalid motion profile.' }, { status: 400, headers: PRIVATE_HEADERS });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Choose a valid clip and confirm its source handedness.' }, { status: 400, headers: PRIVATE_HEADERS });
  }

  const { automaticFallback, clips } = parsed.data;
  const characterName = automaticFallback ? 'Automatic stream fallback' : parsed.data.characterName?.trim();
  if (!characterName) {
    return NextResponse.json({ error: 'Enter the character name exactly as it appears in replay data.' }, { status: 400, headers: PRIVATE_HEADERS });
  }
  const profileKey = automaticFallback
    ? NATIVE_MOTION_AUTOMATIC_PROFILE_KEY
    : nativeMotionProfileKey(characterName);
  if (!profileKey || profileKey === NATIVE_MOTION_AUTOMATIC_PROFILE_KEY && !automaticFallback) {
    return NextResponse.json({ error: 'That profile name is reserved.' }, { status: 400, headers: PRIVATE_HEADERS });
  }

  const selected = Object.fromEntries(
    NATIVE_MOTION_STROKES.flatMap((stroke) => (
      clips[stroke] ? [[stroke, clips[stroke]]] : []
    )),
  ) as NativeMotionPicks;
  if (!NATIVE_MOTION_STROKES.some((stroke) => selected[stroke])) {
    return NextResponse.json({ error: 'Select at least one stroke animation.' }, { status: 400, headers: PRIVATE_HEADERS });
  }
  if (automaticFallback && (['forehand', 'backhand', 'serve'] as const).some((stroke) => !selected[stroke])) {
    return NextResponse.json({ error: 'Automatic fallback needs confirmed forehand, backhand and serve clips. Slice choices are optional.' }, { status: 400, headers: PRIVATE_HEADERS });
  }

  try {
    const catalog = await fetchNativeMotionCatalog();
    const clipsById = new Map(catalog.clips.map((clip) => [clip.id, clip]));
    for (const stroke of NATIVE_MOTION_STROKES) {
      const pick = selected[stroke];
      if (!pick) continue;
      const clip = clipsById.get(pick.clipId);
      if (!clip || !nativeMotionClipSupportsStroke(clip, stroke as NativeMotionStroke)) {
        return NextResponse.json({ error: `The selected ${stroke} clip has no matching SDK event marker.` }, { status: 400, headers: PRIVATE_HEADERS });
      }
      if (automaticFallback && (clip.hidden || clip.accelerationVariant)) {
        return NextResponse.json({ error: 'Automatic fallback cannot use hidden or acceleration variants.' }, { status: 400, headers: PRIVATE_HEADERS });
      }
    }
    await sql`
      INSERT INTO dmo_native_motion_profiles
        (profile_key, character_name, automatic_fallback, clips, updated_at)
      VALUES
        (${profileKey}, ${characterName}, ${automaticFallback}, ${JSON.stringify(selected)}::jsonb, NOW())
      ON CONFLICT (profile_key) DO UPDATE
      SET character_name = EXCLUDED.character_name,
          automatic_fallback = EXCLUDED.automatic_fallback,
          clips = EXCLUDED.clips,
          updated_at = NOW()
    `;
    return NextResponse.json(
      { profile: { profileKey, characterName, automaticFallback, clips: selected } },
      { headers: PRIVATE_HEADERS },
    );
  } catch (error) {
    console.error('[native-motion] profile save failed', error instanceof Error ? error.name : 'UnknownError');
    return NextResponse.json(
      { error: 'Motion profile could not be saved. Confirm the Core asset and Forum database are available.' },
      { status: 503, headers: PRIVATE_HEADERS },
    );
  }
}

export async function DELETE(request: Request) {
  if (!isSameSiteMutation(request)) {
    return NextResponse.json({ error: 'Request origin could not be verified.' }, { status: 403, headers: PRIVATE_HEADERS });
  }
  const user = await requireAdmin();
  if (!user) {
    return NextResponse.json({ error: 'Admin access required.' }, { status: 403, headers: PRIVATE_HEADERS });
  }
  const profileKey = new URL(request.url).searchParams.get('profileKey') || '';
  if (!profileKey || profileKey.length > 100) {
    return NextResponse.json({ error: 'Profile not found.' }, { status: 404, headers: PRIVATE_HEADERS });
  }
  try {
    const rows = await sql`
      DELETE FROM dmo_native_motion_profiles
      WHERE profile_key = ${profileKey}
      RETURNING profile_key
    `;
    if (!rows.length) {
      return NextResponse.json({ error: 'Profile not found.' }, { status: 404, headers: PRIVATE_HEADERS });
    }
    return NextResponse.json({ ok: true }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    console.error('[native-motion] profile delete failed', error instanceof Error ? error.name : 'UnknownError');
    return NextResponse.json({ error: 'Motion profile could not be removed.' }, { status: 503, headers: PRIVATE_HEADERS });
  }
}
