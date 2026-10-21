import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { isSameSiteMutation } from '@/lib/liveRequestSecurity';
import { sql } from '@/lib/db';
import {
  parseDiscordMessageUrl,
  streamLinksInDiscordMessage,
} from '@/lib/liveBroadcast';

export const dynamic = 'force-dynamic';

const PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
};
const startSchema = z.object({
  hasDmo: z.boolean(),
  discordMessageUrl: z.string().trim().max(500).optional().default(''),
  players: z.tuple([z.string().trim().min(1).max(80), z.string().trim().min(1).max(80)]).optional(),
}).strict();
const MAX_BODY_BYTES = 4_000;

async function readJson(request: Request): Promise<unknown> {
  const declaredLength = Number(request.headers.get('content-length') || 0);
  if (declaredLength > MAX_BODY_BYTES) throw new Error('too_large');
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) throw new Error('too_large');
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('invalid_json');
  }
}

export async function POST(request: Request) {
  if (!isSameSiteMutation(request)) {
    return NextResponse.json({ error: 'Request origin could not be verified.' }, { status: 403, headers: PRIVATE_HEADERS });
  }
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: 'Sign in to start a live broadcast.' }, { status: 401, headers: PRIVATE_HEADERS });
  }

  let body: z.infer<typeof startSchema>;
  try {
    body = startSchema.parse(await readJson(request));
  } catch (error) {
    const tooLarge = error instanceof Error && error.message === 'too_large';
    return NextResponse.json(
      { error: tooLarge ? 'Broadcast details are too large.' : 'Broadcast details are invalid.' },
      { status: tooLarge ? 413 : 400, headers: PRIVATE_HEADERS },
    );
  }

  const messageUrl = body.discordMessageUrl.trim();
  if (!body.hasDmo && !messageUrl) {
    return NextResponse.json(
      { error: 'Choose a TE4 recording folder or add a link to your stream message in the WTSL Discord channel.' },
      { status: 400, headers: PRIVATE_HEADERS },
    );
  }
  if (body.players && body.players.some((name) => !name)) {
    return NextResponse.json({ error: 'Enter both player names or leave both blank.' }, { status: 400, headers: PRIVATE_HEADERS });
  }

  let stream: ReturnType<typeof streamLinksInDiscordMessage>[number] | null = null;
  let verifiedMessageUrl: string | null = null;
  if (messageUrl) {
    const reference = parseDiscordMessageUrl(messageUrl);
    if (!reference) {
      return NextResponse.json(
        { error: 'Use a message link from the WTSL live-stream channel.' },
        { status: 400, headers: PRIVATE_HEADERS },
      );
    }
    const token = process.env.DISCORD_BOT_TOKEN;
    if (!token) {
      return NextResponse.json({ error: 'Discord message verification is not configured.' }, { status: 503, headers: PRIVATE_HEADERS });
    }
    let response: Response;
    try {
      response = await fetch(
        `https://discord.com/api/v10/channels/${reference.channelId}/messages/${reference.messageId}`,
        {
          headers: { Authorization: `Bot ${token}` },
          cache: 'no-store',
          signal: AbortSignal.timeout(8_000),
        },
      );
    } catch {
      return NextResponse.json({ error: 'Discord could not be reached to verify the stream link.' }, { status: 502, headers: PRIVATE_HEADERS });
    }
    if (!response.ok) {
      return NextResponse.json({ error: 'The Discord message could not be verified.' }, { status: 502, headers: PRIVATE_HEADERS });
    }
    const message = await response.json().catch(() => null);
    if (
      String(message?.channel_id || '') !== reference.channelId
      || String(message?.id || '') !== reference.messageId
      || String(message?.author?.id || '') !== user.discordId
      || message?.author?.bot
    ) {
      return NextResponse.json(
        { error: 'The stream message must be posted by the Discord account linked to your Forum sign-in.' },
        { status: 403, headers: PRIVATE_HEADERS },
      );
    }
    const streams = streamLinksInDiscordMessage(message);
    if (streams.length !== 1) {
      return NextResponse.json(
        { error: streams.length ? 'Use a Discord message with one YouTube or Twitch stream link.' : 'No supported YouTube or Twitch stream link was found in that message.' },
        { status: 422, headers: PRIVATE_HEADERS },
      );
    }
    stream = streams[0];
    verifiedMessageUrl = `https://discord.com/channels/${reference.guildId}/${reference.channelId}/${reference.messageId}`;
  }

  const payload = {
    stream,
    sourceMessageUrl: verifiedMessageUrl,
    ...(body.players ? { players: body.players } : {}),
  };
  const id = randomUUID();
  try {
    await sql`DELETE FROM dmo_live_broadcasts WHERE expires_at <= NOW()`;
    await sql`
      INSERT INTO dmo_live_broadcasts
        (id, owner_discord_id, status, sequence, payload, started_at, updated_at, expires_at)
      VALUES
        (${id}::uuid, ${user.discordId}, 'live', 0, ${JSON.stringify(payload)}::jsonb, NOW(), NOW(), NOW() + INTERVAL '45 seconds')
    `;
    return NextResponse.json({ id, stream }, { status: 201, headers: PRIVATE_HEADERS });
  } catch (error) {
    console.error('[live-broadcast] start failed', error instanceof Error ? error.name : 'UnknownError');
    return NextResponse.json(
      { error: 'Live broadcasting is temporarily unavailable. The Forum database migration may be pending.' },
      { status: 503, headers: PRIVATE_HEADERS },
    );
  }
}
