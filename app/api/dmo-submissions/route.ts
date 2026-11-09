import { del, get, head, put } from '@vercel/blob';
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { sendDmoSubmission } from '@/lib/discord';
import {
  createDmoSubmission,
  submissionDateInLondon,
  updateDmoDiscordDelivery,
} from '@/lib/dmo-submissions';
import { parseTe4CoachShareUrl } from '@/lib/te4CoachEmbed';
import { syncPublicDmoSubmissionToTe4CoachGroup } from '@/lib/te4CoachGroupServer';
import {
  isOwnedDmoSubmissionUploadPath,
  MAX_DMO_SUBMISSION_BYTES,
  safeDmoSubmissionFileName,
} from '@/lib/dmoSubmissionUpload';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json(
      { error: 'Log in with Discord to submit a match recording.' },
      { status: 401 },
    );
  }

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: 'Could not read the submission.' }, { status: 400 });
  const tournament = String(form.get('tournament') ?? '').trim().slice(0, 100);
  const roundName = String(form.get('round') ?? '').trim().slice(0, 60);
  const player1 = String(form.get('player1') ?? '').trim().slice(0, 100);
  const player2 = String(form.get('player2') ?? '').trim().slice(0, 100);
  const player1Character = String(form.get('player1Character') ?? '').trim().slice(0, 100);
  const player2Character = String(form.get('player2Character') ?? '').trim().slice(0, 100);
  const externalUrl = String(form.get('externalUrl') ?? '').trim().slice(0, 1000);
  const coachShare = parseTe4CoachShareUrl(String(form.get('coachShareUrl') ?? '').slice(0, 500));
  const entry = form.get('file');
  const file = entry instanceof File && entry.size > 0 ? entry : null;
  const uploadedPathname = String(form.get('privateBlobPathname') ?? '').trim();
  const submittedFileName = String(form.get('fileName') ?? '').trim().slice(0, 120);
  const hasDmoFile = Boolean(file || uploadedPathname);
  const publicShareConsent = hasDmoFile && form.get('publicShareConsent') === 'true';
  const coachGroupShareConsent = hasDmoFile
    && publicShareConsent
    && Boolean(coachShare.url)
    && form.get('coachGroupShareConsent') === 'true';

  if (!tournament || !roundName || !player1 || !player2) {
    return NextResponse.json(
      { error: 'Tournament, round, and both player names are required.' },
      { status: 400 },
    );
  }
  if (file && uploadedPathname) {
    return NextResponse.json({ error: 'Submit either a file or a completed private upload, not both.' }, { status: 400 });
  }
  if (!file && !uploadedPathname && !externalUrl) {
    return NextResponse.json(
      { error: 'Attach a .dmo file or provide a recording link.' },
      { status: 400 },
    );
  }
  if (externalUrl) {
    try {
      const url = new URL(externalUrl);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported protocol');
    } catch {
      return NextResponse.json({ error: 'That recording link is not valid.' }, { status: 400 });
    }
  }
  if (!coachShare.valid) {
    return NextResponse.json(
      { error: 'Use an HTTPS TE4 Coach match link from /m, /tv, or a /w dashboard match.' },
      { status: 400 },
    );
  }
  if (file && !file.name.toLowerCase().endsWith('.dmo')) {
    return NextResponse.json({ error: 'Upload a .dmo match recording.' }, { status: 415 });
  }
  if (file && file.size > MAX_DMO_SUBMISSION_BYTES) {
    return NextResponse.json({ error: 'The file is too large (20MB max).' }, { status: 413 });
  }

  let privatePathname: string | null = null;
  let privateContentType: string | null = null;
  let discordFile: Blob | null = file;
  let discordFileUnavailable = false;
  const storeId = process.env.MODERATION_BLOB_STORE_ID;
  if (uploadedPathname) {
    if (!isOwnedDmoSubmissionUploadPath(uploadedPathname, user.id)) {
      return NextResponse.json({ error: 'This upload does not belong to your account.' }, { status: 403 });
    }
    if (!submittedFileName || !submittedFileName.toLowerCase().endsWith('.dmo')) {
      return NextResponse.json({ error: 'The uploaded recording name is not valid.' }, { status: 415 });
    }
    if (!storeId) {
      return NextResponse.json(
        { error: 'Private DMO storage is not configured yet.' },
        { status: 503 },
      );
    }
    try {
      const uploadedBlob = await head(uploadedPathname, { storeId });
      if (uploadedBlob.size > MAX_DMO_SUBMISSION_BYTES) {
        return NextResponse.json({ error: 'The file is too large (20MB max).' }, { status: 413 });
      }
      if (uploadedBlob.contentType !== 'application/octet-stream') {
        return NextResponse.json({ error: 'Upload a .dmo match recording.' }, { status: 415 });
      }
      privatePathname = uploadedPathname;
      privateContentType = uploadedBlob.contentType;
      if (process.env.DISCORD_BOT_TOKEN) {
        try {
          const storedBlob = await get(uploadedPathname, { access: 'private', storeId });
          if (!storedBlob || storedBlob.statusCode !== 200 || !storedBlob.stream) {
            throw new Error('The private DMO file could not be read.');
          }
          const bytes = await new Response(storedBlob.stream).arrayBuffer();
          discordFile = new Blob(
            [bytes],
            { type: privateContentType || storedBlob.blob.contentType || 'application/octet-stream' },
          );
        } catch {
          discordFileUnavailable = true;
          console.error('[dmo] private DMO could not be prepared for Discord delivery');
        }
      }
    } catch {
      return NextResponse.json({ error: 'The uploaded recording could not be verified. Please upload it again.' }, { status: 400 });
    }
  } else if (file) {
    if (!storeId) {
      return NextResponse.json(
        { error: 'Private DMO storage is not configured yet.' },
        { status: 503 },
      );
    }
    try {
      const blob = await put(
        `dmo/${Date.now()}-${safeDmoSubmissionFileName(file.name)}`,
        file,
        {
          access: 'private',
          addRandomSuffix: true,
          contentType: file.type || 'application/octet-stream',
          storeId,
        },
      );
      privatePathname = blob.pathname;
      privateContentType = file.type || 'application/octet-stream';
    } catch (error) {
      console.error('[dmo] private upload failed', error instanceof Error ? error.message : 'Unknown error');
      return NextResponse.json(
        { error: 'The recording could not be stored privately. Please try again later.' },
        { status: 503 },
      );
    }
  }

  let submission;
  try {
    submission = await createDmoSubmission({
      submittedBy: Number(user.id),
      submitterDiscordId: user.discordId,
      submitterName: user.username,
      source: 'forum',
      tournament,
      roundName,
      player1,
      player2,
      player1Character: player1Character || null,
      player2Character: player2Character || null,
      fileName: file?.name.slice(0, 120) ?? (privatePathname ? submittedFileName : null),
      publicShareConsent,
      coachGroupShareConsent,
      coachShareUrl: coachShare.url,
      privateBlobPathname: privatePathname,
      privateBlobContentType: privateContentType,
      externalUrl: externalUrl || null,
      submissionDate: submissionDateInLondon(new Date()),
    });
  } catch (error) {
    if (privatePathname && storeId) {
      await del(privatePathname, { storeId }).catch(() => {});
    }
    throw error;
  }

  let coachGroupSync: 'synced' | 'skipped' | 'not_configured' | 'failed' = 'skipped';
  if (coachGroupShareConsent && coachShare.url) {
    try {
      coachGroupSync = (
        await syncPublicDmoSubmissionToTe4CoachGroup(String(submission.id))
      ).status;
    } catch (error) {
      coachGroupSync = 'failed';
      console.error('[dmo] Coach group sync failed', {
        id: submission.id,
        errorType: error instanceof Error ? error.name : 'UnknownError',
      });
    }
  }

  try {
    if (uploadedPathname && process.env.DISCORD_BOT_TOKEN && discordFileUnavailable) {
      throw new Error('The stored DMO file could not be attached to Discord.');
    }
    const delivery = await sendDmoSubmission({
      submitterName: user.username,
      tournament,
      roundName,
      player1,
      player2,
      player1Character: player1Character || null,
      player2Character: player2Character || null,
      externalUrl: externalUrl || null,
      coachShareUrl: coachShare.url,
      file: discordFile,
      fileName: file?.name ?? (privatePathname ? submittedFileName : null),
    });
    await updateDmoDiscordDelivery(Number(submission.id), {
      status: 'sent',
      messageId: delivery.messageId,
    });
    return NextResponse.json(
      { ok: true, id: submission.id, discordDelivered: true, coachGroupSync },
      { status: 201 },
    );
  } catch (error) {
    await updateDmoDiscordDelivery(Number(submission.id), {
      status: 'failed',
      error: error instanceof Error ? error.message : 'Discord delivery failed.',
    }).catch(() => {});
    console.error('[dmo] saved to Forum; Discord delivery failed');
    return NextResponse.json(
      {
        ok: true,
        id: submission.id,
        discordDelivered: false,
        coachGroupSync,
        message: 'Saved privately for admins, but Discord delivery failed. An admin can retry it from the DMO store.',
      },
      { status: 201 },
    );
  }
}
