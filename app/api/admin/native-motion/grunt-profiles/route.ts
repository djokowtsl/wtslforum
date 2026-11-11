import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { isSameSiteMutation } from '@/lib/liveRequestSecurity';
import { sql } from '@/lib/db';
import {
  dmoCharacterNameKey,
  getDmoCharacterAppearance,
  getDmoCharacterGruntGroups,
  getDmoCharacterProfiles,
  isDmoCharacterGruntGroup,
} from '@/lib/dmoCharacterAppearance.mjs';

export const dynamic = 'force-dynamic';
const HEADERS = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
const bodySchema = z.object({
  characterName: z.string().trim().min(1).max(120),
  gruntGroup: z.union([z.string().max(80), z.null()]),
}).strict();

async function adminUser() {
  const user = await getSession();
  return user?.isAdmin ? user : null;
}

export async function GET() {
  if (!(await adminUser())) {
    return NextResponse.json({ error: 'Admin access required.' }, { status: 403, headers: HEADERS });
  }
  try {
    const rows = await sql`
      SELECT profile_key, character_name, grunt_group
      FROM dmo_character_grunt_profiles
    `;
    const overrides = new Map(rows.map((row: any) => [row.profile_key, row.grunt_group]));
    const profiles = getDmoCharacterProfiles().map((profile) => {
      const hasOverride = overrides.has(profile.key);
      const assignedGroup = hasOverride ? overrides.get(profile.key) ?? null : profile.gruntGroup;
      return {
        ...profile,
        defaultGroup: profile.gruntGroup,
        assignedGroup,
        isOverridden: hasOverride,
      };
    });
    return NextResponse.json({
      profiles,
      groups: getDmoCharacterGruntGroups(),
    }, { headers: HEADERS });
  } catch (error) {
    console.error('[native-motion] grunt profile list failed', error instanceof Error ? error.name : 'UnknownError');
    return NextResponse.json({ error: 'Character grunt profiles are unavailable. Apply the Forum migration, then retry.' }, {
      status: 503,
      headers: HEADERS,
    });
  }
}

export async function PUT(request: Request) {
  if (!isSameSiteMutation(request)) {
    return NextResponse.json({ error: 'Request origin could not be verified.' }, { status: 403, headers: HEADERS });
  }
  if (!(await adminUser())) {
    return NextResponse.json({ error: 'Admin access required.' }, { status: 403, headers: HEADERS });
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > 4_000) {
    return NextResponse.json({ error: 'Character grunt selection is too large.' }, { status: 413, headers: HEADERS });
  }
  let raw: unknown;
  try { raw = JSON.parse(text); } catch {
    return NextResponse.json({ error: 'Invalid character grunt selection.' }, { status: 400, headers: HEADERS });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Choose a character profile and a valid grunt bank.' }, { status: 400, headers: HEADERS });
  }
  const { characterName } = parsed.data;
  const profile = getDmoCharacterAppearance(characterName);
  if (!profile) {
    return NextResponse.json({ error: 'Choose one of the imported character profiles.' }, { status: 400, headers: HEADERS });
  }
  const key = dmoCharacterNameKey(characterName);
  const { gruntGroup } = parsed.data;
  if (gruntGroup !== null && gruntGroup !== '__default__' && !isDmoCharacterGruntGroup(gruntGroup)) {
    return NextResponse.json({ error: 'That grunt bank is not available.' }, { status: 400, headers: HEADERS });
  }
  try {
    if (gruntGroup === '__default__') {
      await sql`DELETE FROM dmo_character_grunt_profiles WHERE profile_key=${key}`;
      return NextResponse.json({ ok: true, profileKey: key, assignedGroup: profile.gruntGroup, isOverridden: false }, {
        headers: HEADERS,
      });
    }
    await sql`
      INSERT INTO dmo_character_grunt_profiles (profile_key, character_name, grunt_group)
      VALUES (${key}, ${profile.name}, ${gruntGroup}::text)
      ON CONFLICT (profile_key) DO UPDATE
        SET character_name=EXCLUDED.character_name,
            grunt_group=EXCLUDED.grunt_group,
            updated_at=NOW()
    `;
    return NextResponse.json({ ok: true, profileKey: key, assignedGroup: gruntGroup, isOverridden: true }, {
      headers: HEADERS,
    });
  } catch (error) {
    console.error('[native-motion] grunt profile save failed', error instanceof Error ? error.name : 'UnknownError');
    return NextResponse.json({ error: 'Character grunt assignment could not be saved.' }, { status: 503, headers: HEADERS });
  }
}
