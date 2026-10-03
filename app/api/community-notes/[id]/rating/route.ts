import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { sql } from '@/lib/db';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Sign in to rate a community note.' }, { status: 401 });
  const { id } = await params;
  const noteId = Number(id);
  const body = await req.json().catch(() => null);
  if (!Number.isSafeInteger(noteId) || noteId < 1 || typeof body?.helpful !== 'boolean') {
    return NextResponse.json({ error: 'Choose helpful or not helpful.' }, { status: 400 });
  }

  const note = await sql`SELECT author_id FROM community_notes WHERE id=${noteId} AND moderation_status='approved' LIMIT 1`;
  if (!note[0]) return NextResponse.json({ error: 'That community note is unavailable.' }, { status: 404 });
  if (String(note[0].author_id) === user.id) {
    return NextResponse.json({ error: 'You cannot rate your own note.' }, { status: 403 });
  }
  await sql`
    INSERT INTO community_note_ratings(note_id,user_id,helpful)
    VALUES (${noteId},${Number(user.id)},${body.helpful})
    ON CONFLICT (note_id,user_id) DO UPDATE SET helpful=EXCLUDED.helpful,updated_at=NOW()
  `;
  return NextResponse.json({ ok: true });
}