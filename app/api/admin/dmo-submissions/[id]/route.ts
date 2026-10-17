import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { updateDmoSubmissionTags } from '@/lib/dmo-submissions';

export const dynamic = 'force-dynamic';

function cleanRequiredText(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
}

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSession();
  if (!user?.isAdmin) {
    return NextResponse.json({ error: 'Admin access required.' }, { status: 403 });
  }

  const { id } = await params;
  const submissionId = Number(id);
  if (!Number.isSafeInteger(submissionId) || submissionId < 1) {
    return NextResponse.json({ error: 'Invalid submission id.' }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const tournament = cleanRequiredText(body?.tournament, 100);
  const roundName = cleanRequiredText(body?.roundName, 60);
  const player1 = cleanRequiredText(body?.player1, 100);
  const player2 = cleanRequiredText(body?.player2, 100);
  const submissionDate = body?.submissionDate;

  if (!tournament || !roundName || !player1 || !player2 || !validDate(submissionDate)) {
    return NextResponse.json(
      { error: 'Tournament, round, both players, and a valid submission date are required.' },
      { status: 400 },
    );
  }

  const updated = await updateDmoSubmissionTags(submissionId, {
    tournament,
    roundName,
    player1,
    player2,
    submissionDate,
  });
  if (!updated) {
    return NextResponse.json({ error: 'DMO submission not found.' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
