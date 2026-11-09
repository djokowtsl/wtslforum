import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { isDmoReplayId } from '@/lib/dmoReplayLibrary';
import { setDmoSubmissionHidden } from '@/lib/dmo-submissions';

export const dynamic = 'force-dynamic';

const PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
};

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSession();
  if (!user?.isAdmin) {
    return NextResponse.json({ error: 'Admin access required.' }, { status: 403, headers: PRIVATE_HEADERS });
  }

  const { id } = await params;
  if (!isDmoReplayId(id)) {
    return NextResponse.json({ error: 'Invalid submission id.' }, { status: 400, headers: PRIVATE_HEADERS });
  }

  const body = await request.json().catch(() => null);
  if (typeof body?.hidden !== 'boolean') {
    return NextResponse.json({ error: 'Choose whether the replay should be hidden.' }, { status: 400, headers: PRIVATE_HEADERS });
  }

  try {
    const updated = await setDmoSubmissionHidden({
      id,
      hidden: body.hidden,
      hiddenBy: user.discordId,
    });
    if (!updated) {
      return NextResponse.json({ error: 'DMO submission not found.' }, { status: 404, headers: PRIVATE_HEADERS });
    }
    return NextResponse.json({ ok: true, hidden: body.hidden }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    console.error('[dmo] admin visibility update failed', {
      id,
      errorType: error instanceof Error ? error.name : 'UnknownError',
    });
    return NextResponse.json(
      { error: 'The replay visibility could not be changed right now.' },
      { status: 503, headers: PRIVATE_HEADERS },
    );
  }
}
