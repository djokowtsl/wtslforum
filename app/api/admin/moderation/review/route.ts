import { NextResponse } from 'next/server';
import { del, get, put } from '@vercel/blob';
import { canModerateComments, getSession } from '@/lib/auth';
import { sql } from '@/lib/db';
import { announceTopic } from '@/lib/discord';

const contentKinds = ['topic', 'reply', 'media', 'note'] as const;
type ContentKind = typeof contentKinds[number];

export async function POST(req: Request) {
  const user = await getSession();
  if (!canModerateComments(user)) return NextResponse.json({ error: 'Moderator access required.' }, { status: 403 });
  const body = await req.json().catch(() => null);
  const kind = body?.kind as ContentKind;
  const id = Number(body?.id);
  const action = body?.action;
  if (!contentKinds.includes(kind) || !Number.isSafeInteger(id) || id < 1 || !['approve', 'remove'].includes(action)) {
    return NextResponse.json({ error: 'Choose a valid item and review action.' }, { status: 400 });
  }

  const nextStatus = action === 'approve' ? 'approved' : 'removed';
  if (kind === 'topic') {
    const rows = await sql`
      UPDATE topics SET moderation_status=${nextStatus},moderation_reason=NULL,moderated_by=${Number(user!.id)},moderated_at=NOW(),updated_at=NOW()
      WHERE id=${id} AND moderation_status='pending'
      RETURNING id,title,author_id
    `;
    if (!rows[0]) return NextResponse.json({ error: 'This discussion is no longer awaiting review.' }, { status: 409 });
    if (action === 'approve') {
      if (rows[0].author_id) {
        const author = await sql`SELECT display_name FROM users WHERE id=${rows[0].author_id} LIMIT 1`;
        await announceTopic(rows[0].title, id, author[0]?.display_name || 'WTSL').catch(() => {});
      }
    } else {
      await sql`DELETE FROM match_threads WHERE topic_id=${id}`;
    }
  } else if (kind === 'reply') {
    const rows = await sql`
      UPDATE replies SET moderation_status=${nextStatus},moderation_reason=NULL,moderated_by=${Number(user!.id)},moderated_at=NOW(),updated_at=NOW()
      WHERE id=${id} AND moderation_status='pending'
      RETURNING topic_id
    `;
    if (!rows[0]) return NextResponse.json({ error: 'This reply is no longer awaiting review.' }, { status: 409 });
    if (action === 'approve') await sql`UPDATE topics SET updated_at=NOW() WHERE id=${rows[0].topic_id}`;
  } else if (kind === 'note') {
    const rows = action === 'approve'
      ? await sql`
          UPDATE community_notes SET moderation_status='approved',moderation_reason=NULL,moderated_by=${Number(user!.id)},moderated_at=NOW()
          WHERE id=${id} AND moderation_status='pending' RETURNING id
        `
      : await sql`
          UPDATE community_notes SET moderation_status='removed',moderation_reason=NULL,moderated_by=${Number(user!.id)},moderated_at=NOW()
          WHERE id=${id} AND moderation_status IN ('pending','approved') RETURNING id
        `;
    if (!rows[0]) return NextResponse.json({ error: 'This note is no longer awaiting review.' }, { status: 409 });
  } else {
    const rows = await sql`
      SELECT private_blob_pathname,private_blob_content_type,url
      FROM media_clips WHERE id=${id} AND moderation_status='pending' LIMIT 1
    `;
    if (!rows[0]) return NextResponse.json({ error: 'This media submission is no longer awaiting review.' }, { status: 409 });

    let approvedUrl = rows[0].url;
    const pathname = rows[0].private_blob_pathname as string | null;
    const storeId = process.env.MODERATION_BLOB_STORE_ID;
    if (action === 'approve' && pathname) {
      if (!storeId) return NextResponse.json({ error: 'Private moderation storage is not configured.' }, { status: 503 });
      const staged = await get(pathname, { access: 'private', storeId });
      if (!staged || staged.statusCode !== 200 || !staged.stream) {
        return NextResponse.json({ error: 'The staged upload could not be read. It remains in the review queue.' }, { status: 503 });
      }
      const published = await put(`media/approved-${id}`, staged.stream, {
        access: 'public',
        addRandomSuffix: true,
        contentType: rows[0].private_blob_content_type || 'application/octet-stream',
      });
      approvedUrl = published.url;
    }
    const updated = await sql`
      UPDATE media_clips
      SET moderation_status=${nextStatus},moderation_reason=NULL,moderated_by=${Number(user!.id)},moderated_at=NOW(),
          url=${action === 'approve' ? approvedUrl : rows[0].url},
          private_blob_pathname=NULL,private_blob_content_type=NULL
      WHERE id=${id} AND moderation_status='pending'
      RETURNING id
    `;
    if (!updated[0]) return NextResponse.json({ error: 'This media submission changed while being reviewed.' }, { status: 409 });
    if (pathname && storeId) await del(pathname, { storeId }).catch(() => {});
  }

  return NextResponse.json({ ok: true });
}