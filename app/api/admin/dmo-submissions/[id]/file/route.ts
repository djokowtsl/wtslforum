import { get } from '@vercel/blob';
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getDmoSubmission } from '@/lib/dmo-submissions';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  if (!user?.isAdmin) {
    return NextResponse.json({ error: 'Admin access required.' }, { status: 403 });
  }
  const { id } = await params;
  const submissionId = Number(id);
  if (!Number.isSafeInteger(submissionId) || submissionId < 1) {
    return NextResponse.json({ error: 'Invalid submission id.' }, { status: 400 });
  }
  const submission = await getDmoSubmission(submissionId);
  if (!submission?.private_blob_pathname) {
    return NextResponse.json({ error: 'The private DMO file is unavailable.' }, { status: 404 });
  }
  const storeId = process.env.MODERATION_BLOB_STORE_ID;
  if (!storeId) {
    return NextResponse.json({ error: 'Private DMO storage is not configured.' }, { status: 503 });
  }

  const result = await get(submission.private_blob_pathname, { access: 'private', storeId });
  if (!result || result.statusCode !== 200 || !result.stream) {
    return new NextResponse('DMO file unavailable', { status: 404 });
  }
  const filename = String(submission.file_name || `match-${submissionId}.dmo`)
    .replace(/[\r\n"]/g, '_')
    .slice(0, 120);
  return new NextResponse(result.stream, {
    headers: {
      'Content-Type': submission.private_blob_content_type || result.blob.contentType || 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  });
}
