import { NextResponse } from 'next/server';
import { get } from '@vercel/blob';
import { canModerateComments, getSession } from '@/lib/auth';
import { sql } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  if (!canModerateComments(user)) return NextResponse.json({ error: 'Moderator access required.' }, { status: 403 });
  const { id } = await params;
  const mediaId = Number(id);
  if (!Number.isSafeInteger(mediaId) || mediaId < 1) return NextResponse.json({ error: 'Invalid media id.' }, { status: 400 });

  const rows = await sql`
    SELECT private_blob_pathname,private_blob_content_type
    FROM media_clips WHERE id=${mediaId} AND moderation_status='pending' LIMIT 1
  `;
  const pathname = rows[0]?.private_blob_pathname as string | undefined;
  const storeId = process.env.MODERATION_BLOB_STORE_ID;
  if (!pathname || !storeId) return NextResponse.json({ error: 'Private preview is unavailable.' }, { status: 404 });

  const result = await get(pathname, { access: 'private', storeId });
  if (!result || result.statusCode !== 200 || !result.stream) return new NextResponse('Preview unavailable', { status: 404 });
  return new NextResponse(result.stream, {
    headers: {
      'Content-Type': rows[0].private_blob_content_type || result.blob.contentType || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    },
  });
}