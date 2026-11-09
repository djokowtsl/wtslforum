import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import {
  dmoReplayCatalogMetadata,
  getDmoReplaySubmission,
  getPublicDmoReplay,
  isDmoReplayId,
  publicDmoReplayCatalogMetadata,
  type DmoSubmissionReplay,
  type StoredDmoReplay,
} from '@/lib/dmoReplayLibrary';

export const dynamic = 'force-dynamic';

const PUBLIC_HEADERS = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
};

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  const { id } = await params;
  if (!isDmoReplayId(id)) {
    return NextResponse.json({ error: 'Match replay not found.' }, { status: 404, headers: PUBLIC_HEADERS });
  }

  try {
    const replay = user
      ? await getDmoReplaySubmission(id)
      : await getPublicDmoReplay(id);
    if (!replay) {
      return NextResponse.json({ error: 'Match replay not found.' }, { status: 404, headers: PUBLIC_HEADERS });
    }
    const metadata = user
      ? dmoReplayCatalogMetadata(replay as DmoSubmissionReplay)
      : publicDmoReplayCatalogMetadata(replay as StoredDmoReplay);
    return NextResponse.json(metadata, { headers: PUBLIC_HEADERS });
  } catch {
    return NextResponse.json(
      { error: 'Match replay is temporarily unavailable.' },
      { status: 503, headers: { ...PUBLIC_HEADERS, 'Cache-Control': 'no-store' } },
    );
  }
}
