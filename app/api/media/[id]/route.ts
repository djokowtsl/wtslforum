import { NextRequest, NextResponse } from 'next/server';
import { canModerateComments, getSession } from '@/lib/auth';
import { sql } from '@/lib/db';
import { deleteClip } from '@/lib/media';
import { del } from '@vercel/blob';

export const dynamic = 'force-dynamic';

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  const { id } = await params;
  const clipId = Number(id);
  if (!clipId) return NextResponse.json({ error: 'Invalid id.' }, { status: 400 });

  const rows = await sql`SELECT submitted_by,private_blob_pathname FROM media_clips WHERE id=${clipId}`;
  if (!canModerateComments(user)) {
    if (!rows[0] || String(rows[0].submitted_by) !== user.id) return NextResponse.json({ error: 'You can only remove your own submissions.' }, { status: 403 });
  }
  await deleteClip(clipId);
  if (rows[0]?.private_blob_pathname && process.env.MODERATION_BLOB_STORE_ID) {
    await del(rows[0].private_blob_pathname, { storeId: process.env.MODERATION_BLOB_STORE_ID }).catch(() => {});
  }
  return NextResponse.json({ ok: true });
}
