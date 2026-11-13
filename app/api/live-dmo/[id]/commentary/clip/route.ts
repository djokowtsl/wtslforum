import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  findLiveCommentaryBroadcast,
  getDmoLiveCommentaryClip,
  getDmoLivePhrasebook,
} from '@/lib/dmoLiveCommentary';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ERROR_HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
type RouteContext = { params: Promise<{ id: string }> };

// New lines are word-checked; this also caps how many one device can request.
// Best effort per server instance.
const WINDOW_MS = 10 * 60_000;
const MAX_REQUESTS_PER_WINDOW = 400;
const recentRequests = new Map<string, number[]>();
function rateLimited(request: Request) {
  const client = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip') || 'unknown';
  const now = Date.now();
  const recent = (recentRequests.get(client) ?? []).filter((at) => now - at < WINDOW_MS);
  const limited = recent.length >= MAX_REQUESTS_PER_WINDOW;
  if (!limited) recent.push(now);
  recentRequests.set(client, recent);
  if (recentRequests.size > 5_000) recentRequests.clear();
  return limited;
}

/** One live commentary line as MP3 (`?voice=af_heart&text=...`). */
export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const params = new URL(request.url).searchParams;
  const voice = params.get('voice') ?? '';
  const text = params.get('text') ?? '';
  if (!z.string().uuid().safeParse(id).success || !text || text.length > 320) {
    return NextResponse.json({ error: 'Commentary line not found.' }, { status: 404, headers: ERROR_HEADERS });
  }
  if (rateLimited(request)) {
    return NextResponse.json({ error: 'Too many commentary requests.' }, {
      status: 429, headers: { ...ERROR_HEADERS, 'Retry-After': '60' },
    });
  }
  const storeId = process.env.MODERATION_BLOB_STORE_ID;
  if (!storeId) {
    return NextResponse.json({ error: 'Commentary storage is not configured.' }, { status: 503, headers: ERROR_HEADERS });
  }
  try {
    const broadcast = await findLiveCommentaryBroadcast(id);
    if (!broadcast) {
      return NextResponse.json({ error: 'Broadcast not found.' }, { status: 404, headers: ERROR_HEADERS });
    }
    const book = await getDmoLivePhrasebook(broadcast, storeId);
    const audio = await getDmoLiveCommentaryClip(book, { text, voice }, storeId);
    if (!audio) {
      return NextResponse.json({ error: 'Commentary line not allowed.' }, { status: 400, headers: ERROR_HEADERS });
    }
    return new Response(Buffer.from(audio), {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': String(audio.byteLength),
        'Cache-Control': 'private, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return NextResponse.json({ error: 'Commentary audio is temporarily unavailable.' }, {
      status: 503, headers: ERROR_HEADERS,
    });
  }
}
