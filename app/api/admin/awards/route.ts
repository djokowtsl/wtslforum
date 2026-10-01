import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { sql } from '@/lib/db';
import { addNominee, removeNominee, setVotingOpen, importGoogleFormVotes } from '@/lib/awards';

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
    const imported = await importGoogleFormVotes(categoryId, rows);
    return NextResponse.json({ ok: true, imported });
  }

  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
}
