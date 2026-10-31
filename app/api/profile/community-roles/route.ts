import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { notifyForumAdminsForReview } from '@/lib/discord';
import { FORUM_ROLE_LABELS, isManualForumRoleKey, requestForumRole } from '@/lib/forumRoles';

export async function POST(req: Request) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Sign in with Discord first.' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const roleKey = body?.roleKey;
  if (!isManualForumRoleKey(roleKey)) {
    return NextResponse.json({ error: 'Choose a role that requires verification.' }, { status: 400 });
  }

  try {
    await requestForumRole(user.id, roleKey);
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Unable to request this role.',
    }, { status: 409 });
  }

  await notifyForumAdminsForReview(
    `A ${FORUM_ROLE_LABELS[roleKey]} role request needs review.`,
    '/admin/roles',
  );
  return NextResponse.json({ ok: true });
}
