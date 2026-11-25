import { gzipSync } from 'node:zlib';
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { buildDmoIntegrityReport } from '@/lib/dmoIntegrity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// The analyzer's report is self-contained: inline script and styles only, no
// network access (its own CSP says the same).
// Vercel caps a function response at 4.5 MB. The report embeds every frame's
// inputs (a long match is 10+ MB of HTML) but compresses about 5:1.
const MAX_RESPONSE_BYTES = 4_300_000;

const REPORT_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; frame-ancestors 'none'";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  if (!user?.isAdmin) return NextResponse.json({ error: 'Admin access required.' }, { status: 403 });
  const { id } = await params;
  const submissionId = Number(id);
  if (!Number.isSafeInteger(submissionId) || submissionId < 1) {
    return NextResponse.json({ error: 'Invalid submission id.' }, { status: 400 });
  }
  let html: string | null;
  try {
    html = await buildDmoIntegrityReport(submissionId);
  } catch (error) {
    const message = error instanceof Error ? error.message.split('\n')[0].slice(0, 300) : 'Unknown error';
    return new NextResponse(`The analyzer couldn't read this recording: ${message}`, {
      status: 422,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'private, no-store' },
    });
  }
  if (!html) return NextResponse.json({ error: 'The private DMO file is unavailable.' }, { status: 404 });
  const body = gzipSync(Buffer.from(html, 'utf8'), { level: 6 });
  if (body.byteLength > MAX_RESPONSE_BYTES) {
    return new NextResponse(
      'This match is too long to show the full report here. Download the DMO from the DMO store and run the analyzer on your computer.',
      { status: 413, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'private, no-store' } },
    );
  }
  return new NextResponse(body, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Encoding': 'gzip',
      'Content-Length': String(body.byteLength),
      'Vary': 'Accept-Encoding',
      'Content-Security-Policy': REPORT_CSP,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'private, no-store',
    },
  });
}
