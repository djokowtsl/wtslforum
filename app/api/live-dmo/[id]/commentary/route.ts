import { after, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  findLiveCommentaryBroadcast,
  getDmoLivePhrasebook,
  prepareDmoLivePhrasebook,
} from '@/lib/dmoLiveCommentary';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const HEADERS = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Readiness of a broadcast's pre-made commentary. Each call also spends up to
 * 45 seconds (after answering) storing more of its phrasebook, so pages that
 * check in while a broadcast is open get it fully prepared.
 */
export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'Broadcast not found.' }, { status: 404, headers: HEADERS });
  }
  const storeId = process.env.MODERATION_BLOB_STORE_ID;
  if (!storeId) {
    return NextResponse.json({ error: 'Commentary storage is not configured.' }, { status: 503, headers: HEADERS });
  }
  try {
    const broadcast = await findLiveCommentaryBroadcast(id);
    if (!broadcast) {
      return NextResponse.json({ error: 'Broadcast not found.' }, { status: 404, headers: HEADERS });
    }
    const book = await getDmoLivePhrasebook(broadcast, storeId);
    if (!book.complete) {
      after(() => prepareDmoLivePhrasebook(broadcast, book, storeId).then(() => undefined));
    }
    return NextResponse.json({ complete: Boolean(book.complete), lines: book.lines.length }, { headers: HEADERS });
  } catch {
    return NextResponse.json({ error: 'Live commentary is temporarily unavailable.' }, { status: 503, headers: HEADERS });
  }
}
