import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import {
  NATIVE_MOTION_AUTOMATIC_PROFILE_KEY,
  nativeMotionProfileKey,
  type NativeMotionPicks,
  type NativeMotionProfile,
} from '@/lib/nativeMotionCatalogData';

export const dynamic = 'force-dynamic';

const PROFILE_HEADERS = {
  'Cache-Control': 'public, max-age=5, s-maxage=5',
  'X-Content-Type-Options': 'nosniff',
};
const PROFILE_KEY_NONE = '';
const BROADCAST_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const playerNames = [params.get('player1') ?? '', params.get('player2') ?? ''] as const;
  if (playerNames.some((name) => name.length > 100)) {
    return NextResponse.json({ error: 'Player name is too long.' }, { status: 400, headers: PROFILE_HEADERS });
  }
  const broadcastId = params.get('broadcastId');
  if (broadcastId && !BROADCAST_ID_RE.test(broadcastId)) {
    return NextResponse.json({ error: 'Broadcast not found.' }, { status: 404, headers: PROFILE_HEADERS });
  }
  const exactKeys = playerNames.map(nativeMotionProfileKey) as [string, string];
  const useFallback = params.get('fallback') === '1';

  try {
    const profiles = await sql`
      SELECT profile_key, character_name, automatic_fallback, clips, updated_at
      FROM dmo_native_motion_profiles
      WHERE profile_key IN (
        ${exactKeys[0] || PROFILE_KEY_NONE},
        ${exactKeys[1] || PROFILE_KEY_NONE},
        ${useFallback ? NATIVE_MOTION_AUTOMATIC_PROFILE_KEY : PROFILE_KEY_NONE}
      )
    ` as ProfileRow[];
    const profileByKey = new Map(profiles.map((row) => [row.profile_key, toProfile(row)]));
    const overrideKeys: [string | null, string | null] = [null, null];

    if (broadcastId) {
      const overrideRows = await sql`
        SELECT o.player_index, p.profile_key, p.character_name, p.automatic_fallback, p.clips, p.updated_at
        FROM dmo_native_motion_stream_overrides o
        JOIN dmo_live_broadcasts b ON b.id = o.broadcast_id
        JOIN dmo_native_motion_profiles p
          ON p.profile_key = o.profile_key AND p.automatic_fallback = FALSE
        WHERE o.broadcast_id = ${broadcastId}::uuid
          AND b.expires_at > NOW()
          AND b.payload->>'mode' = 'manual'
      ` as Array<ProfileRow & { player_index: number }>;
      for (const row of overrideRows) {
        if (row.player_index === 0 || row.player_index === 1) {
          overrideKeys[row.player_index] = row.profile_key;
          profileByKey.set(row.profile_key, toProfile(row));
        }
      }
    }

    const playerProfileKeys = exactKeys.map((key, index) => (
      overrideKeys[index]
      ?? (profileByKey.has(key) ? key : null)
      ?? (useFallback && profileByKey.has(NATIVE_MOTION_AUTOMATIC_PROFILE_KEY)
        ? NATIVE_MOTION_AUTOMATIC_PROFILE_KEY
        : null)
    )) as [string | null, string | null];
    const usedKeys = new Set(playerProfileKeys.filter((key): key is string => key !== null));
    return NextResponse.json(
      {
        playerProfileKeys,
        profiles: [...usedKeys].flatMap((key) => {
          const profile = profileByKey.get(key);
          return profile ? [profile] : [];
        }),
      },
      { headers: PROFILE_HEADERS },
    );
  } catch (error) {
    console.error('[native-motion] profile lookup failed', error instanceof Error ? error.name : 'UnknownError');
    return NextResponse.json(
      { error: 'Native animation profiles are temporarily unavailable.' },
      { status: 503, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } },
    );
  }
}
