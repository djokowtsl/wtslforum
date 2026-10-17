import { del, put } from '@vercel/blob';
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { sendDmoSubmission } from '@/lib/discord';
import {
  createDmoSubmission,
  submissionDateInLondon,
  updateDmoDiscordDelivery,
} from '@/lib/dmo-submissions';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_BYTES = 20 * 1024 * 1024;

function safeFilename(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100) || 'match-recording.dmo';
}

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
  const externalUrl = String(form.get('externalUrl') ?? '').trim().slice(0, 1000);
  const entry = form.get('file');
  const file = entry instanceof File && entry.size > 0 ? entry : null;

  if (!tournament || !roundName || !player1 || !player2) {
    return NextResponse.json(
      { error: 'Tournament, round, and both player names are required.' },
      { status: 400 },
    );
  }
  if (!file && !externalUrl) {
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
  if (file && !file.name.toLowerCase().endsWith('.dmo')) {
    return NextResponse.json({ error: 'Upload a .dmo match recording.' }, { status: 415 });
  }
  if (file && file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'The file is too large (20MB max).' }, { status: 413 });
  }

  let privatePathname: string | null = null;
  let privateContentType: string | null = null;
  const storeId = process.env.MODERATION_BLOB_STORE_ID;
  if (file) {
    if (!storeId) {
      return NextResponse.json(
        { error: 'Private DMO storage is not configured yet.' },
        { status: 503 },
      );
    }
    try {
      const blob = await put(
        `dmo/${Date.now()}-${safeFilename(file.name)}`,
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
      fileName: file?.name.slice(0, 120) ?? null,
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

  try {
    const delivery = await sendDmoSubmission({
      submitterName: user.username,
      tournament,
      roundName,
      player1,
      player2,
      externalUrl: externalUrl || null,
      file,
      fileName: file?.name ?? null,
    });
    await updateDmoDiscordDelivery(Number(submission.id), {
      status: 'sent',
      messageId: delivery.messageId,
    });
    return NextResponse.json(
      { ok: true, id: submission.id, discordDelivered: true },
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
        message: 'Saved privately for admins, but Discord delivery failed. An admin can retry it from the DMO store.',
      },
      { status: 201 },
    );
  }
}
