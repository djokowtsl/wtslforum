import { NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { getSession } from '@/lib/auth';
import { articleImageType, MAX_ARTICLE_IMAGE_BYTES } from '@/lib/articleUploads';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const user = await getSession();
  if (!user?.isAdmin) return NextResponse.json({ error: 'Admin access required.' }, { status: 403 });
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json({ error: 'Article image storage is not configured. Ask the site administrator to connect Vercel Blob storage.' }, { status: 503 });
  }
  const requestSize = Number(req.headers.get('content-length'));
  if (requestSize > MAX_ARTICLE_IMAGE_BYTES + 65536) return NextResponse.json({ error: 'Images must be 4 MB or smaller.' }, { status: 413 });
  try {
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File) || !file.size) return NextResponse.json({ error: 'Choose an image file.' }, { status: 400 });
    if (file.size > MAX_ARTICLE_IMAGE_BYTES) return NextResponse.json({ error: 'Images must be 4 MB or smaller.' }, { status: 413 });
    const bytes = new Uint8Array(await file.arrayBuffer());
    const contentType = articleImageType(bytes);
    if (!contentType) return NextResponse.json({ error: 'Use a JPG, PNG, GIF, or WebP image. SVG and other file types are not allowed.' }, { status: 415 });
    const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' }[contentType];
    const blob = await put(`articles/${user.id}/${crypto.randomUUID()}.${extension}`, Buffer.from(bytes), {
      access: 'public', contentType, addRandomSuffix: false,
    });
    return NextResponse.json({ url: blob.url, name: file.name }, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Image upload failed. Please try again; your article content has been kept.' }, { status: 503 });
  }
}
