import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { isSameSiteMutation } from '@/lib/liveRequestSecurity';
import { sql } from '@/lib/db';
import {
  NATIVE_MOTION_AUTOMATIC_PROFILE_KEY,
  NATIVE_MOTION_STROKES,
  nativeMotionCharacterDefaults,
  nativeMotionProfileKey,
  type NativeMotionPicks,
  type NativeMotionProfile,
} from '@/lib/nativeMotionCatalogData';
import { fetchNativeMotionCatalog } from '@/lib/nativeMotionServer';

export const dynamic = 'force-dynamic';

const PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
};

type CharacterHandRow = {
  character_name: string;
  playing_hand: string | null;
};

type ProfileRow = {
  profile_key: string;
  character_name: string;
  automatic_fallback: boolean;
  clips: NativeMotionPicks;
  updated_at: Date | string;
};

function toProfile(row: ProfileRow): NativeMotionProfile {
  return {
    profileKey: row.profile_key,
    characterName: row.character_name,
    automaticFallback: Boolean(row.automatic_fallback),
    clips: row.clips ?? {},
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export async function POST(request: Request) {
  if (!isSameSiteMutation(request)) {
    return NextResponse.json({ error: 'Request origin could not be verified.' }, { status: 403, headers: PRIVATE_HEADERS });
  }
  const user = await getSession();
  if (!user?.isAdmin) {
    return NextResponse.json({ error: 'Admin access required.' }, { status: 403, headers: PRIVATE_HEADERS });
  }

  try {
    const [catalog, rows] = await Promise.all([
      fetchNativeMotionCatalog(),
      sql`
        WITH recent_submissions AS (
          SELECT
            player1_character, player1_handedness,
            player2_character, player2_handedness
          FROM dmo_submissions
          WHERE hidden_at IS NULL
          ORDER BY id DESC
          LIMIT 500
        ), replay_characters AS (
          SELECT
            NULLIF(BTRIM(player1_character), '') AS character_name,
            player1_handedness AS playing_hand
          FROM recent_submissions
          UNION ALL
          SELECT
            NULLIF(BTRIM(player2_character), '') AS character_name,
            player2_handedness AS playing_hand
          FROM recent_submissions
        )
        SELECT character_name, playing_hand
        FROM replay_characters
        WHERE character_name IS NOT NULL
        ORDER BY character_name
      ` as Promise<CharacterHandRow[]>,
    ]);

    const characters = new Map<string, { name: string; hands: Set<'left' | 'right'> }>();
    for (const row of rows) {
      const name = row.character_name.trim().replace(/\s+/g, ' ');
      const key = nativeMotionProfileKey(name);
      if (!key || key === NATIVE_MOTION_AUTOMATIC_PROFILE_KEY) continue;
      const entry = characters.get(key) ?? { name, hands: new Set<'left' | 'right'>() };
      if (row.playing_hand === 'left' || row.playing_hand === 'right') {
        entry.hands.add(row.playing_hand);
      }
      characters.set(key, entry);
    }

    const candidates: Array<{
      profile_key: string;
      character_name: string;
      clips: NativeMotionPicks;
    }> = [];
    let skippedHandedness = 0;
    let skippedClips = 0;

    for (const [profileKey, character] of characters) {
      if (character.hands.size !== 1) {
        skippedHandedness += 1;
        continue;
      }
      const [playingHand] = character.hands;
      const defaults = nativeMotionCharacterDefaults(catalog, character.name);
      const clips: NativeMotionPicks = {};
      for (const stroke of NATIVE_MOTION_STROKES) {
        const clip = defaults[stroke];
        if (clip) clips[stroke] = { clipId: clip.id, sourceHandedness: playingHand };
      }
      if (!Object.keys(clips).length) {
        skippedClips += 1;
        continue;
      }
      candidates.push({ profile_key: profileKey, character_name: character.name, clips });
    }

    const inserted = candidates.length
      ? await sql`
          INSERT INTO dmo_native_motion_profiles
            (profile_key, character_name, automatic_fallback, clips, updated_at)
          SELECT
            generated.profile_key,
            generated.character_name,
            FALSE,
            generated.clips,
            NOW()
          FROM jsonb_to_recordset(${JSON.stringify(candidates)}::jsonb)
            AS generated(profile_key text, character_name text, clips jsonb)
          ON CONFLICT (profile_key) DO NOTHING
          RETURNING profile_key, character_name, automatic_fallback, clips, updated_at
        ` as ProfileRow[]
      : [];

    return NextResponse.json({
      created: inserted.map(toProfile),
      skippedHandedness,
      skippedClips,
      alreadyConfigured: Math.max(0, candidates.length - inserted.length),
    }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    console.error('[native-motion] automatic profile creation failed', error instanceof Error ? error.name : 'UnknownError');
    return NextResponse.json(
      { error: 'Character defaults could not be generated. Confirm the Forum database and Core catalog are available.' },
      { status: 503, headers: PRIVATE_HEADERS },
    );
  }
}
