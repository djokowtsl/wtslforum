import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import {
  countPendingIntegrityScans,
  listPendingIntegrityScans,
  scanDmoSubmission,
  type DmoIntegrityStatus,
} from '@/lib/dmoIntegrity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Each recording takes a few seconds. Stop starting new ones well before the
// function limit; the admin page calls again until nothing is left.
const TIME_BUDGET_MS = 200_000;
const MAX_PER_REQUEST = 25;

export async function GET() {
  const user = await getSession();
  if (!user?.isAdmin) return NextResponse.json({ error: 'Admin access required.' }, { status: 403 });
  return NextResponse.json({ pending: await countPendingIntegrityScans() });
}

export async function POST(request: Request) {
  const user = await getSession();
  if (!user?.isAdmin) return NextResponse.json({ error: 'Admin access required.' }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const requested = Array.isArray(body?.ids)
    ? body.ids.map(Number).filter((id: number) => Number.isSafeInteger(id) && id > 0).slice(0, MAX_PER_REQUEST)
    : null;
  const ids: number[] = requested ?? await listPendingIntegrityScans(MAX_PER_REQUEST);

  const started = Date.now();
  const results: { id: number; status: DmoIntegrityStatus | 'error' }[] = [];
  for (const id of ids) {
    if (Date.now() - started > TIME_BUDGET_MS) break;
    try {
      results.push({ id, status: await scanDmoSubmission(id) });
    } catch (error) {
      console.error('[dmo-integrity] scan request failed', { id, errorType: error instanceof Error ? error.name : 'UnknownError' });
      results.push({ id, status: 'error' });
    }
  }
  return NextResponse.json({
    scanned: results,
    pending: requested ? 0 : await countPendingIntegrityScans(),
  });
}
