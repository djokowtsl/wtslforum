import { NextResponse } from 'next/server';
import { getDmoCommentaryContext } from '@/lib/liveScores';

export const dynamic = 'force-dynamic';

const PUBLIC_HEADERS = {
  'Cache-Control': 'public, max-age=30, stale-while-revalidate=300',
  'X-Content-Type-Options': 'nosniff',
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const first = url.searchParams.get('first')?.trim() ?? '';
  const second = url.searchParams.get('second')?.trim() ?? '';
  const tour = url.searchParams.get('tour');
  if (
    !first || first.length > 80
    || !second || second.length > 80
    || (tour !== 'ATP' && tour !== 'WTA')
  ) {
    return NextResponse.json({ error: 'A valid player pair and tour are required.' }, {
      status: 400,
      headers: PUBLIC_HEADERS,
    });
  }

  try {
    const context = await getDmoCommentaryContext([first, second], tour === 'WTA');
    return NextResponse.json({ context }, { headers: PUBLIC_HEADERS });
  } catch {
    return NextResponse.json(
      { error: 'WTSL commentary context is temporarily unavailable.' },
      { status: 503, headers: { ...PUBLIC_HEADERS, 'Cache-Control': 'no-store' } },
    );
  }
}
