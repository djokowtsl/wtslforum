import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { sql } from '@/lib/db';

export async function POST(req: Request) {
  const user = await getSession();
  if (!user?.isAdmin) return NextResponse.json({ error: 'Admin only.' }, { status: 403 });

  const body = await req.json().catch(() => null);
  const userId = Number(body?.userId);
  if (!Number.isSafeInteger(userId) || userId < 1 || typeof body?.isAdmin !== 'boolean' || typeof body?.isModerator !== 'boolean') {
    return NextResponse.json({ error: 'Choose a member and valid roles.' }, { status: 400 });
  }
  const target = await sql`SELECT id,discord_id,is_admin FROM users WHERE id=${userId} LIMIT 1`;
  if (!target[0]) return NextResponse.json({ error: 'Member not found.' }, { status: 404 });

  const bootstrapAdmins = (process.env.ADMIN_DISCORD_IDS || '').split(',').map((id) => id.trim()).filter(Boolean);
  const bootstrapModerators = (process.env.MODERATOR_DISCORD_IDS || '').split(',').map((id) => id.trim()).filter(Boolean);
  if (bootstrapAdmins.includes(target[0].discord_id) && !body.isAdmin) {
    return NextResponse.json({ error: 'Configured bootstrap admins cannot be removed here. Update ADMIN_DISCORD_IDS to change that recovery path.' }, { status: 409 });
  }
  if (bootstrapModerators.includes(target[0].discord_id) && !body.isModerator) {
    return NextResponse.json({ error: 'Configured moderators cannot be removed here. Update MODERATOR_DISCORD_IDS to change that list.' }, { status: 409 });
  }

  const updated = bootstrapAdmins.length === 0 && !body.isAdmin
    ? await sql`
        UPDATE users SET is_admin=${body.isAdmin},is_moderator=${body.isModerator},updated_at=NOW()
        WHERE id=${userId} AND (is_admin=FALSE OR EXISTS (SELECT 1 FROM users other_admin WHERE other_admin.is_admin=TRUE AND other_admin.id<>${userId}))
        RETURNING id
      `
    : await sql`
        UPDATE users SET is_admin=${body.isAdmin},is_moderator=${body.isModerator},updated_at=NOW()
        WHERE id=${userId} RETURNING id
      `;
  if (!updated[0]) return NextResponse.json({ error: 'At least one administrator must remain.' }, { status: 409 });
  return NextResponse.json({ ok: true });
}