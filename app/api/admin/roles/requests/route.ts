import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { notifyForumRoleDecision } from '@/lib/discord';
import { FORUM_ROLE_LABELS, reviewForumRoleRequest } from '@/lib/forumRoles';

export async function POST(req: Request) {
  const admin = await getSession();
  if (!admin?.isAdmin) return NextResponse.json({ error: 'Admin access required.' }, { status: 403 });

  const body = await req.json().catch(() => null);
  const requestId = Number(body?.requestId);
  const decision = body?.decision;
  if (!Number.isSafeInteger(requestId) || requestId < 1 || !['approved', 'rejected'].includes(decision)) {
    return NextResponse.json({ error: 'Choose a valid request and decision.' }, { status: 400 });
  }

  const reviewed = await reviewForumRoleRequest(requestId, admin.id, decision);
  if (!reviewed) return NextResponse.json({ error: 'This request was already reviewed or no longer exists.' }, { status: 409 });
  await notifyForumRoleDecision(
    reviewed.discordId,
    FORUM_ROLE_LABELS[reviewed.roleKey],
    reviewed.decision,
  );
  return NextResponse.json({ ok: true });
}
