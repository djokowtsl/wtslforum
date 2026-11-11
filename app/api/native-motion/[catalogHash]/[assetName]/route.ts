import { NextResponse } from 'next/server';
import { NATIVE_MOTION_CATALOG_SHA256 } from '@/lib/nativeMotionCatalog';

export const dynamic = 'force-dynamic';

const ASSET_HEADERS = {
  'Cache-Control': 'public, max-age=31536000, s-maxage=31536000, immutable',
  'X-Content-Type-Options': 'nosniff',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ catalogHash: string; assetName: string }> },
) {
  const { catalogHash, assetName } = await params;
  if (
    catalogHash !== NATIVE_MOTION_CATALOG_SHA256
    || (assetName !== 'catalog.json' && !/^[a-f0-9]+_[a-f0-9]+\.wtm$/.test(assetName))
  ) {
    return NextResponse.json({ error: 'Native animation asset not found.' }, { status: 404 });
  }

  const base = (process.env.WTSL_CORE_API_URL || '').replace(/\/+$/, '');
  const token = process.env.WTSL_CORE_API_KEY || '';
  if (!base || !token) {
    return NextResponse.json(
      { error: 'Native animation delivery is not configured.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  try {
    const url = `${base}/api/core/native-motion/${catalogHash}/${assetName}`;
    const upstream = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json, application/octet-stream' },
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
    });
    if (!upstream.ok) {
      return NextResponse.json(
        { error: upstream.status === 404 ? 'Native animation asset not found.' : 'Native animation delivery is temporarily unavailable.' },
        { status: upstream.status === 404 ? 404 : 503, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    return new Response(upstream.body, {
      status: 200,
      headers: {
        ...ASSET_HEADERS,
        'Content-Type': assetName === 'catalog.json' ? 'application/json; charset=utf-8' : 'application/vnd.wtsl.wtm1',
        ...(upstream.headers.get('content-length')
          ? { 'Content-Length': upstream.headers.get('content-length')! }
          : {}),
      },
    });
  } catch {
    return NextResponse.json(
      { error: 'Native animation delivery is temporarily unavailable.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
