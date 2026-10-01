import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const MAX_BYTES = 20 * 1024 * 1024; // 20MB — large match videos should be linked (YouTube/Discord/Streamable) instead.

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Log in with Discord to upload a clip.' }, { status: 401 });
  if (!process.env.BLOB_READ_WRITE_TOKEN) return NextResponse.json({ error: 'File uploads are not configured yet — paste a link instead.' }, { status: 503 });

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'No file received.' }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'File is too large (20MB max) — paste a link to a hosted clip instead.' }, { status: 413 });

  const blob = await put(`media/${Date.now()}-${file.name}`, file, { access: 'public', addRandomSuffix: true });
  return NextResponse.json({ ok: true, url: blob.url });
}
