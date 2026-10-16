import { del, get } from '@vercel/blob';
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { analyzeDmoBuffer } from '@/lib/te4DmoAnalysis';
import { MAX_DMO_BYTES, Te4DmoAnalysisError } from '@/lib/te4DmoParser';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const UPLOAD_PREFIX = 'dmo-analysis/';
const RESPONSE_CHUNK_BYTES = 64 * 1024;

function isAllowedPath(pathname: string): boolean {
  if (!pathname.startsWith(UPLOAD_PREFIX) || pathname.length > 180) return false;
  if (!pathname.toLowerCase().endsWith('.dmo') || pathname.includes('\\')) return false;
  return !pathname.split('/').some((segment) => segment === '.' || segment === '..');
}

function streamedJson(body: unknown, status = 200): Response {
  const encoded = Buffer.from(JSON.stringify(body), 'utf8');
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let offset = 0; offset < encoded.length; offset += RESPONSE_CHUNK_BYTES) {
        controller.enqueue(encoded.subarray(offset, offset + RESPONSE_CHUNK_BYTES));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export async function POST(request: Request) {
  const user = await getSession();
  if (!user?.isAdmin) {
    return NextResponse.json(
      { error: 'Admin access required.' },
      { status: 403, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }

  const storeId = process.env.MODERATION_BLOB_STORE_ID;
  if (!storeId) {
    return NextResponse.json(
      { error: 'Private DMO storage is not configured.' },
      { status: 503, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json(
      { error: 'Invalid analysis request.' },
      { status: 400, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }
  const pathname = typeof body.pathname === 'string' ? body.pathname : '';
  const filename = typeof body.filename === 'string' ? body.filename.trim().slice(0, 160) : '';
  if (!isAllowedPath(pathname) || !filename.toLowerCase().endsWith('.dmo')) {
    return NextResponse.json(
      { error: 'Choose a valid uploaded .dmo recording.' },
      { status: 400, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }

  let uploaded = false;
  try {
    const blob = await get(pathname, { access: 'private', storeId, useCache: false });
    if (!blob || blob.statusCode !== 200 || !blob.stream) {
      return NextResponse.json(
        { error: 'The private DMO upload could not be found.' },
        { status: 404, headers: { 'Cache-Control': 'private, no-store' } },
      );
    }
    uploaded = true;
    if (blob.blob.size > MAX_DMO_BYTES) {
      return NextResponse.json(
        { error: 'The DMO file is larger than the 64 MiB analysis limit.' },
        { status: 413, headers: { 'Cache-Control': 'private, no-store' } },
      );
    }

    const bytes = Buffer.from(await new Response(blob.stream).arrayBuffer());
    if (bytes.length > MAX_DMO_BYTES) {
      return NextResponse.json(
        { error: 'The DMO file is larger than the 64 MiB analysis limit.' },
        { status: 413, headers: { 'Cache-Control': 'private, no-store' } },
      );
    }
    return streamedJson(analyzeDmoBuffer(bytes, filename));
  } catch (error) {
    if (error instanceof Te4DmoAnalysisError) {
      return NextResponse.json(
        { error: error.message },
        { status: 422, headers: { 'Cache-Control': 'private, no-store' } },
      );
    }
    console.error('[dmo-analysis] analysis failed');
    return NextResponse.json(
      { error: 'The DMO recording could not be analyzed. Try another recording or contact an administrator.' },
      { status: 500, headers: { 'Cache-Control': 'private, no-store' } },
    );
  } finally {
    if (uploaded) {
      await del(pathname, { storeId }).catch(() => {
        console.error('[dmo-analysis] temporary upload cleanup failed');
      });
    }
  }
}
