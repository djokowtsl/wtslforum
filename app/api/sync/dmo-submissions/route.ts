import { del, put } from '@vercel/blob';
import { NextRequest, NextResponse } from 'next/server';
import { isWtslSyncAuthorized } from '@/lib/wtslSyncAuth';
import {
  createDmoSubmission,
  findDmoSubmissionByDiscordMessage,
} from '@/lib/dmo-submissions';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DMO_ADMIN_CHANNEL_ID = '1055277431398866995';
const MAX_BYTES = 64 * 1024 * 1024;

function cleanText(value: unknown, maxLength: number) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function validHttpUrl(value: string) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString().slice(0, 1000) : null;
  } catch {
    return null;
  }
}

function safeFilename(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100) || 'match-recording.dmo';
}

export async function POST(req: NextRequest) {
  if (!isWtslSyncAuthorized(req.headers)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  const tournament = cleanText(body?.tournament, 100);
  const roundName = cleanText(body?.round, 60);
  const player1 = cleanText(body?.player1, 100);
  const player2 = cleanText(body?.player2, 100);
  const submitterDiscordId = cleanText(body?.submitterDiscordId, 32);
  const submitterName = cleanText(body?.submitterName, 100) || 'Discord member';
  const channelId = cleanText(body?.discordChannelId, 32);
  const messageId = cleanText(body?.discordMessageId, 32);
  const submissionThreadId = cleanText(body?.submissionThreadId, 32) || null;
  const externalUrl = validHttpUrl(cleanText(body?.externalUrl, 1000));

  if (!tournament || !roundName || !player1 || !player2 || !channelId || !messageId) {
    return NextResponse.json({ error: 'The DMO submission details are incomplete.' }, { status: 400 });
  }
  if (channelId !== DMO_ADMIN_CHANNEL_ID) {
    return NextResponse.json({ error: 'The source Discord channel is not the DMO admin channel.' }, { status: 400 });
  }
  if (body?.externalUrl && !externalUrl) {
    return NextResponse.json({ error: 'The recording link is invalid.' }, { status: 400 });
  }

  const existing = await findDmoSubmissionByDiscordMessage(channelId, messageId);
  if (existing) return NextResponse.json({ ok: true, id: existing.id, duplicate: true });

  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    return NextResponse.json({ error: 'Discord file retrieval is not configured.' }, { status: 503 });
  }
  const messageResponse = await fetch(
    `https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`,
    { headers: { Authorization: `Bot ${token}` }, cache: 'no-store' },
  );
  if (!messageResponse.ok) {
    return NextResponse.json({ error: 'The Discord admin message could not be verified.' }, { status: 502 });
  }
  const discordMessage = await messageResponse.json();
  const attachments = Array.isArray(discordMessage?.attachments) ? discordMessage.attachments : [];
  const attachment = attachments.find(
    (item: any) => String(item?.filename || '').toLowerCase().endsWith('.dmo'),
  );

  if (!attachment && !externalUrl) {
    return NextResponse.json({ error: 'No .dmo file or recording link was found.' }, { status: 422 });
  }

  let privatePathname: string | null = null;
  let privateContentType: string | null = null;
  const fileName = attachment ? safeFilename(String(attachment.filename)) : null;
  const storeId = process.env.MODERATION_BLOB_STORE_ID;
  if (attachment) {
    if (!storeId) {
      return NextResponse.json({ error: 'Private DMO storage is not configured.' }, { status: 503 });
    }
    const advertisedSize = Number(attachment.size) || 0;
    if (advertisedSize > MAX_BYTES) {
      return NextResponse.json({ error: 'The DMO file exceeds the 64MB archive limit.' }, { status: 413 });
    }
    let attachmentUrl: URL;
    try {
      attachmentUrl = new URL(String(attachment.url || ''));
    } catch {
      return NextResponse.json({ error: 'The Discord attachment URL is invalid.' }, { status: 502 });
    }
    if (
      !['cdn.discordapp.com', 'media.discordapp.net'].includes(attachmentUrl.hostname)
    ) {
      return NextResponse.json({ error: 'The Discord attachment host is not trusted.' }, { status: 502 });
    }
    const fileResponse = await fetch(attachmentUrl, { cache: 'no-store' });
    if (!fileResponse.ok) {
      return NextResponse.json({ error: 'The Discord DMO file could not be downloaded.' }, { status: 502 });
    }
    const bytes = Buffer.from(await fileResponse.arrayBuffer());
    if (bytes.byteLength > MAX_BYTES) {
      return NextResponse.json({ error: 'The DMO file exceeds the 64MB archive limit.' }, { status: 413 });
    }
    privateContentType = String(attachment.content_type || 'application/octet-stream');
    try {
      const blob = await put(`dmo/discord-${messageId}-${fileName}`, bytes, {
        access: 'private',
        addRandomSuffix: true,
        contentType: privateContentType,
        storeId,
      });
      privatePathname = blob.pathname;
    } catch (error) {
      console.error('[dmo] Discord archive upload failed', error instanceof Error ? error.message : 'Unknown error');
      return NextResponse.json({ error: 'The Discord DMO could not be stored privately.' }, { status: 503 });
    }
  }

  try {
    const submission = await createDmoSubmission({
      submittedBy: null,
      submitterDiscordId: submitterDiscordId || null,
      submitterName,
      source: 'discord',
      tournament,
      roundName,
      player1,
      player2,
      fileName,
      privateBlobPathname: privatePathname,
      privateBlobContentType: privateContentType,
      externalUrl,
      sourceDiscordChannelId: channelId,
      sourceDiscordMessageId: messageId,
      submissionThreadId,
      discordMessageId: messageId,
      discordDeliveryStatus: 'sent',
    });
    if (privatePathname && storeId && submission.private_blob_pathname !== privatePathname) {
      await del(privatePathname, { storeId }).catch(() => {});
    }
    return NextResponse.json({ ok: true, id: submission.id }, { status: 201 });
  } catch (error) {
    if (privatePathname && storeId) {
      await del(privatePathname, { storeId }).catch(() => {});
    }
    throw error;
  }
}
