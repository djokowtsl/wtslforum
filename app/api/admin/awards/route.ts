import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { sql } from '@/lib/db';
import { addNominee, removeNominee, setVotingOpen, importGoogleFormOptions, importGoogleFormVotes, getSiteAwardVotesForCycle } from '@/lib/awards';
import { fetchPublicGoogleFormOptions } from '@/lib/googleFormOptions';
import { syncAwardVotesToSheet } from '@/lib/awardVoteSheetSync';

export const dynamic = 'force-dynamic';

async function requireAdmin() {
  const user = await getSession();
  if (!user?.isAdmin) return null;
  return user;
}

/** Very small CSV reader: one Google Form export line per voter — handle, nominee name (optional), write-in (optional). */
function parseCsv(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(',').map((cell) => cell.trim().replace(/^"|"$/g, '')));
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'Admins only.' }, { status: 403 });

  const body = await req.json().catch(() => null);
  const action = body?.action;

  if (action === 'preview-form-options' || action === 'import-form-options') {
    const cycleId = Number(body?.cycleId);
    const formUrl = String(body?.formUrl ?? '').trim();
    if (!cycleId || !formUrl) return NextResponse.json({ error: 'Choose an award cycle and enter a public Google Form link.' }, { status: 400 });
    if (formUrl.length > 500) return NextResponse.json({ error: 'The Google Form link is too long.' }, { status: 400 });

    const cycles = await sql`SELECT id FROM award_cycles WHERE id=${cycleId} LIMIT 1`;
    if (!cycles.length) return NextResponse.json({ error: 'Award cycle not found.' }, { status: 404 });

    try {
      const form = await fetchPublicGoogleFormOptions(formUrl);
      if (action === 'preview-form-options') {
        const optionCount = form.questions.reduce((total, question) => total + question.options.length, 0);
        return NextResponse.json({
          ok: true,
          sourceUrl: form.sourceUrl,
          questionCount: form.questions.length,
          optionCount,
          questions: form.questions.map((question) => ({
            title: question.title,
            slug: question.slug,
            optionCount: question.options.length,
            allowWriteIn: question.allowWriteIn,
            examples: question.options.slice(0, 3),
          })),
        });
      }

      const imported = await importGoogleFormOptions(cycleId, form.questions);
      return NextResponse.json({ ok: true, sourceUrl: form.sourceUrl, ...imported });
    } catch (error) {
      return NextResponse.json({
        error: error instanceof Error ? error.message : 'Could not import Google Form choices.',
      }, { status: 400 });
    }
  }

  if (action === 'sync-sheet-batch') {
    const cycleId = Number(body?.cycleId);
    const afterVoteId = String(body?.afterVoteId ?? '0');
    if (!cycleId || !/^\d{1,20}$/.test(afterVoteId)) {
      return NextResponse.json({ error: 'Choose an award cycle and a valid sync position.' }, { status: 400 });
    }

    const cycles = await sql`SELECT id FROM award_cycles WHERE id=${cycleId} LIMIT 1`;
    if (!cycles.length) return NextResponse.json({ error: 'Award cycle not found.' }, { status: 404 });

    const votes = await getSiteAwardVotesForCycle(cycleId, afterVoteId, 100);
    const result = await syncAwardVotesToSheet(votes);
    if (result.status !== 'synced') {
      const error = result.status === 'not_configured'
        ? 'Google Sheets sync is not configured yet.'
        : result.status === 'misconfigured'
          ? 'Google Sheets sync settings are incomplete or invalid.'
          : 'Some Forum votes could not be synced. You can retry this sync.';
      return NextResponse.json({ error }, { status: 503 });
    }

    const nextAfterVoteId = String(votes.at(-1)?.voteId ?? afterVoteId);
    return NextResponse.json({
      ok: true,
      nextAfterVoteId,
      done: votes.length < 100,
    });
  }

  if (action === 'toggle-voting') {
    const cycleId = Number(body?.cycleId);
    const open = Boolean(body?.open);
    if (!cycleId) return NextResponse.json({ error: 'Missing cycleId.' }, { status: 400 });
    await setVotingOpen(cycleId, open);
    return NextResponse.json({ ok: true });
  }

  if (action === 'add-nominee') {
    const categoryId = Number(body?.categoryId);
    const name = String(body?.name ?? '').trim().slice(0, 120);
    const note = String(body?.note ?? '').trim().slice(0, 240);
    if (!categoryId || !name) return NextResponse.json({ error: 'Missing categoryId or name.' }, { status: 400 });
    const nominee = await addNominee(categoryId, name, note);
    return NextResponse.json({ ok: true, nominee });
  }

  if (action === 'remove-nominee') {
    const nomineeId = Number(body?.nomineeId);
    if (!nomineeId) return NextResponse.json({ error: 'Missing nomineeId.' }, { status: 400 });
    await removeNominee(nomineeId);
    return NextResponse.json({ ok: true });
  }

  if (action === 'import-csv') {
    const categoryId = Number(body?.categoryId);
    const csv = String(body?.csv ?? '');
    if (!categoryId || !csv.trim()) return NextResponse.json({ error: 'Missing categoryId or csv.' }, { status: 400 });

    const nominees = await sql`SELECT id, name FROM award_nominees WHERE category_id = ${categoryId}`;
    const byName = new Map(nominees.map((n: any) => [n.name.toLowerCase(), n.id]));

    const rows = parseCsv(csv).map(([voterKey, nomineeName, writeIn]) => {
      const matchedId = nomineeName ? byName.get(nomineeName.toLowerCase()) : undefined;
      return { voterKey, nomineeId: matchedId ?? null, writeIn: matchedId ? null : (nomineeName || writeIn || null) };
    });
    await importGoogleFormVotes(categoryId, rows);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
}
