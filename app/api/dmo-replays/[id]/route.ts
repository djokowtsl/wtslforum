import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getPublicDmoReplay, isDmoReplayId, publicDmoReplayMetadata } from '@/lib/dmoReplayLibrary';

export const dynamic = 'force-dynamic';

const PUBLIC_HEADERS = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
};

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  if (!user?.isAdmin) {
    return NextResponse.json(
      { error: 'Match replays are temporarily unavailable. Access is limited to Forum admins.' },
      { status: user ? 403 : 401, headers: PUBLIC_HEADERS },
    );
  }
  const { id } = await params;
  if (!isDmoReplayId(id)) {
    return NextResponse.json({ error: 'Match replay not found.' }, { status: 404, headers: PUBLIC_HEADERS });
  }

  try {
    const replay = await getPublicDmoReplay(id);
    if (!replay) {
      return NextResponse.json({ error: 'Match replay not found.' }, { status: 404, headers: PUBLIC_HEADERS });
    }
    return NextResponse.json(publicDmoReplayMetadata(replay), { headers: PUBLIC_HEADERS });
  } catch {
    return NextResponse.json(
      { error: 'Match replay is temporarily unavailable.' },
      { status: 503, headers: { ...PUBLIC_HEADERS, 'Cache-Control': 'no-store' } },
    );
  }
}
