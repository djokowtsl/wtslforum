import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import {
  isDmoReplayId,
  publishDmoReplaySubmission,
  revokeDmoReplayPublicationOverride,
} from '@/lib/dmoReplayLibrary';

export const dynamic = 'force-dynamic';

const PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
};

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  const user = await getSession();
  if (!user?.isAdmin) {
    return NextResponse.json({ error: 'Admin access required.' }, { status: 403, headers: PRIVATE_HEADERS });
  }

  const { id } = await params;
  if (!isDmoReplayId(id)) {
    return NextResponse.json({ error: 'Invalid submission id.' }, { status: 400, headers: PRIVATE_HEADERS });
  }

  const body = await request.json().catch(() => null);
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
  if (reason.length < 5 || reason.length > 500) {
    return NextResponse.json(
      { error: 'Enter a publishing reason between 5 and 500 characters.' },
      { status: 400, headers: PRIVATE_HEADERS },
    );
  }

  try {
    const published = await publishDmoReplaySubmission({
      id,
      authorizedBy: user.discordId,
      reason,
    });
    if (!published) {
      return NextResponse.json(
        { error: 'A stored DMO file is required for public playback.' },
        { status: 404, headers: PRIVATE_HEADERS },
      );
    }
    return NextResponse.json({ ok: true }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    console.error('[dmo] admin publication failed', {
      id,
      errorType: error instanceof Error ? error.name : 'UnknownError',
    });
    return NextResponse.json(
      { error: 'The replay could not be published right now.' },
      { status: 503, headers: PRIVATE_HEADERS },
    );
  }
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const user = await getSession();
  if (!user?.isAdmin) {
    return NextResponse.json({ error: 'Admin access required.' }, { status: 403, headers: PRIVATE_HEADERS });
  }

  const { id } = await params;
  if (!isDmoReplayId(id)) {
    return NextResponse.json({ error: 'Invalid submission id.' }, { status: 400, headers: PRIVATE_HEADERS });
  }

  try {
    await revokeDmoReplayPublicationOverride(id);
    return NextResponse.json({ ok: true }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    console.error('[dmo] admin publication revocation failed', {
      id,
      errorType: error instanceof Error ? error.name : 'UnknownError',
    });
    return NextResponse.json(
      { error: 'The admin publication could not be removed right now.' },
      { status: 503, headers: PRIVATE_HEADERS },
    );
  }
}
