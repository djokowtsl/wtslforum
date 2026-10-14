import { get } from '@vercel/blob';
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { sendDmoSubmission } from '@/lib/discord';
import {
  getDmoSubmission,
  updateDmoDiscordDelivery,
} from '@/lib/dmo-submissions';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
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
  if (!submission) return NextResponse.json({ error: 'Submission not found.' }, { status: 404 });
  if (submission.source !== 'forum') {
    return NextResponse.json({ error: 'Only Forum submissions can be retried here.' }, { status: 409 });
  }

  let file: Blob | null = null;
  if (submission.private_blob_pathname) {
    const storeId = process.env.MODERATION_BLOB_STORE_ID;
    if (!storeId) {
      return NextResponse.json({ error: 'Private DMO storage is not configured.' }, { status: 503 });
    }
    const result = await get(submission.private_blob_pathname, { access: 'private', storeId });
    if (!result || result.statusCode !== 200 || !result.stream) {
      return NextResponse.json({ error: 'The private DMO file could not be read.' }, { status: 503 });
    }
    file = await new Response(result.stream).blob();
  }

  try {
    const delivery = await sendDmoSubmission({
      submitterName: submission.account_name || submission.submitter_name,
      tournament: submission.tournament,
      roundName: submission.round_name,
      player1: submission.player1,
      player2: submission.player2,
      externalUrl: submission.external_url,
      file,
      fileName: submission.file_name,
    });
    await updateDmoDiscordDelivery(submissionId, {
      status: 'sent',
      messageId: delivery.messageId,
    });
    return NextResponse.json({ ok: true });
  } catch {
    await updateDmoDiscordDelivery(submissionId, {
      status: 'failed',
      error: 'Discord delivery failed during the admin retry.',
    }).catch(() => {});
    return NextResponse.json({ error: 'Discord delivery failed. The submission remains in the Forum store.' }, { status: 502 });
  }
}
