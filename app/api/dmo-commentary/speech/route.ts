import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { normalizeDmoSpeechRequest } from '@/lib/dmoCommentarySpeech.mjs';
import {
  COMMENTARY_MAINTENANCE_MESSAGE,
  isCommentaryRestrictionActive,
} from '@/lib/dmoCommentaryMaintenance.mjs';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Replay access can be restricted, so audio must never enter a shared cache.
// The bot keeps a bounded in-memory cache of synthesized lines instead.
const AUDIO_HEADERS = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
  'Cross-Origin-Resource-Policy': 'same-origin',
};
const PRIVATE_ERROR_HEADERS = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
};

// Best-effort per-user limit for uncached synthesis. The bot endpoint also
// requires the existing WTSL Core bearer key, so it is not publicly callable.
const WINDOW_MS = 10 * 60_000;
const MAX_UNCACHED_PER_WINDOW = 120;
const recentRequests = new Map<string, number[]>();

function rateLimited(userId: string) {
  const now = Date.now();
  const recent = (recentRequests.get(userId) ?? []).filter((at) => now - at < WINDOW_MS);
  if (recent.length >= MAX_UNCACHED_PER_WINDOW) {
    recentRequests.set(userId, recent);
    return true;
  }
  recent.push(now);
  recentRequests.set(userId, recent);
  if (recentRequests.size > 5_000) {
    for (const [id, timestamps] of recentRequests) {
      if (!timestamps.some((at) => now - at < WINDOW_MS)) recentRequests.delete(id);
      if (recentRequests.size <= 4_000) break;
    }
  }
  return false;
}

export async function GET(request: Request) {
  if (isCommentaryRestrictionActive()) {
    return NextResponse.json(
      { error: COMMENTARY_MAINTENANCE_MESSAGE },
      { status: 503, headers: { ...PRIVATE_ERROR_HEADERS, 'Retry-After': 'Sat, 14 Nov 2026 08:00:00 GMT' } },
    );
  }
  const user = await getSession();
  if (!user) {
    return NextResponse.json(
      { error: 'Sign in to use commentary speech.' },
      { status: 401, headers: PRIVATE_ERROR_HEADERS },
    );
  }
  if (request.url.length > 4_096) {
    return NextResponse.json({ error: 'Invalid commentary speech request.' }, {
      status: 400,
      headers: PRIVATE_ERROR_HEADERS,
    });
  }

  const params = new URL(request.url).searchParams;
  const speech = normalizeDmoSpeechRequest({
    text: params.get('text') ?? '',
    voice: params.get('voice') ?? '',
    speed: params.get('speed') ?? undefined,
  });
  if (!speech) {
    return NextResponse.json({ error: 'Invalid commentary speech request.' }, {
      status: 400,
      headers: PRIVATE_ERROR_HEADERS,
    });
  }
  if (rateLimited(user.discordId)) {
    return NextResponse.json(
      { error: 'Too many commentary voice requests. Try again shortly.' },
      { status: 429, headers: { ...PRIVATE_ERROR_HEADERS, 'Retry-After': '60' } },
    );
  }

  const base = (process.env.WTSL_CORE_API_URL || '').replace(/\/+$/, '');
  const token = process.env.WTSL_CORE_API_KEY || '';
  if (!base || !token) {
    return NextResponse.json(
      { error: 'The commentary voice is not configured.' },
      { status: 503, headers: PRIVATE_ERROR_HEADERS },
    );
  }

  try {
    const upstream = await fetch(`${base}/api/core/commentary/speech`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'audio/wav, application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(speech),
      cache: 'no-store',
      signal: AbortSignal.timeout(55_000),
    });
    const contentLength = Number(upstream.headers.get('content-length') || 0);
    if (
      !upstream.ok
      || !upstream.headers.get('content-type')?.startsWith('audio/wav')
      || contentLength > 2_000_000
    ) {
      return NextResponse.json(
        { error: 'The commentary voice is temporarily unavailable.' },
        { status: upstream.status === 400 ? 400 : 503, headers: PRIVATE_ERROR_HEADERS },
      );
    }
    const audio = await upstream.arrayBuffer();
    if (audio.byteLength === 0 || audio.byteLength > 2_000_000) {
      return NextResponse.json(
        { error: 'The commentary voice returned invalid audio.' },
        { status: 503, headers: PRIVATE_ERROR_HEADERS },
      );
    }
    return new Response(audio, {
      status: 200,
      headers: {
        ...AUDIO_HEADERS,
        'Content-Type': 'audio/wav',
        'Content-Length': String(audio.byteLength),
      },
    });
  } catch {
    return NextResponse.json(
      { error: 'The commentary voice is temporarily unavailable.' },
      { status: 503, headers: PRIVATE_ERROR_HEADERS },
    );
  }
}
