import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { addClip } from '@/lib/media';
import { isTourCode } from '@/lib/wtsl';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Log in with Discord to submit a clip.' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const title = String(body?.title ?? '').trim().slice(0, 120);
  const description = String(body?.description ?? '').trim().slice(0, 500);
  const url = String(body?.url ?? '').trim();
  const tour = isTourCode(body?.tour) ? body.tour : null;
  if (!title || !url) return NextResponse.json({ error: 'A title and a link or uploaded file are required.' }, { status: 400 });
  if (!/^https?:\/\//i.test(url)) return NextResponse.json({ error: 'That link does not look valid.' }, { status: 400 });

  const clip = await addClip(Number(user.id), title, description, url, tour);
  return NextResponse.json({ ok: true, clip }, { status: 201 });
}
