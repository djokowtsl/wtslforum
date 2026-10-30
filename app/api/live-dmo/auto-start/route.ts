import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { sql } from '@/lib/db';
import { startExternalLiveBroadcast } from '@/lib/liveBroadcastStart';
import { LIVE_STREAM_CHANNEL_ID, LIVE_STREAM_GUILD_ID, streamLinksInDiscordMessage } from '@/lib/liveBroadcast';
import { readSiteSnapshot } from '@/lib/siteSnapshots';
import type { PublicFixturePayload } from '@/lib/liveFeedTypes';
import {
  findOngoingTournamentMatchInText,
  isFreshTournamentMatchSnapshot,
} from '@/lib/liveBroadcastTournamentMatches';

export const dynamic = 'force-dynamic';
const PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
};
const requestSchema = z.object({
  messageId: z.string().regex(/^[1-9]\d{16,19}$/),
}).strict();
const MAX_BODY_BYTES = 512;
const DISCORD_API = 'https://discord.com/api/v10';

function secretsMatch(expected: string, actual: string) {
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(actual);
  return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes);
}

export async function POST(request: Request) {
  const expectedSecret = process.env.WTSL_SYNC_SECRET?.trim();
  const providedSecret = request.headers.get('x-wtsl-sync-secret')?.trim() || '';
  if (!expectedSecret) {
    return NextResponse.json({ error: 'Automatic stream intake is not configured.' }, { status: 503, headers: PRIVATE_HEADERS });
  }
  if (!providedSecret || !secretsMatch(expectedSecret, providedSecret)) {
    return NextResponse.json({ error: 'Not authorized.' }, { status: 401, headers: PRIVATE_HEADERS });
  }

  const declaredLength = Number(request.headers.get('content-length') || 0);
  if (declaredLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'Stream request is too large.' }, { status: 413, headers: PRIVATE_HEADERS });
  }
  let body: z.infer<typeof requestSchema>;
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
      return NextResponse.json({ error: 'Stream request is too large.' }, { status: 413, headers: PRIVATE_HEADERS });
    }
    body = requestSchema.parse(JSON.parse(text));
  } catch {
    return NextResponse.json({ error: 'Invalid stream request.' }, { status: 400, headers: PRIVATE_HEADERS });
  }

  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!botToken) {
    return NextResponse.json({ error: 'Discord verification is not configured.' }, { status: 503, headers: PRIVATE_HEADERS });
  }

  let message: any;
  try {
    const response = await fetch(
      `${DISCORD_API}/channels/${LIVE_STREAM_CHANNEL_ID}/messages/${body.messageId}`,
      {
        headers: { Authorization: `Bot ${botToken}` },
        cache: 'no-store',
        signal: AbortSignal.timeout(8_000),
      },
    );
    if (!response.ok) {
      return NextResponse.json({ error: 'The Discord post could not be verified.' }, { status: 422, headers: PRIVATE_HEADERS });
    }
    message = await response.json();
  } catch {
    return NextResponse.json({ error: 'Discord could not be reached to verify the post.' }, { status: 502, headers: PRIVATE_HEADERS });
  }

  const authorDiscordId = String(message?.author?.id || '');
  if (
    String(message?.id || '') !== body.messageId
    || String(message?.channel_id || '') !== LIVE_STREAM_CHANNEL_ID
    || message?.author?.bot
    || !/^[1-9]\d{0,19}$/.test(authorDiscordId)
  ) {
    return NextResponse.json({ error: 'The post is not an eligible member stream link.' }, { status: 422, headers: PRIVATE_HEADERS });
  }

  const streams = streamLinksInDiscordMessage(message);
  if (streams.length !== 1) {
    return NextResponse.json({
      error: streams.length
        ? 'Post exactly one supported stream link per message.'
        : 'No supported YouTube or Twitch link was found in that post.',
    }, { status: 422, headers: PRIVATE_HEADERS });
  }

  try {
    const members = await sql`
      SELECT discord_id, COALESCE(NULLIF(display_name, ''), username) AS display_name
      FROM users
      WHERE discord_id=${authorDiscordId}
      LIMIT 1
    `;
    if (!members[0]) {
      return NextResponse.json({ error: 'Only verified Forum members can start a stream.' }, { status: 403, headers: PRIVATE_HEADERS });
    }

    let tournamentMatch = null;
    try {
      const snapshot = await readSiteSnapshot<PublicFixturePayload>('live-fixtures');
      if (snapshot && isFreshTournamentMatchSnapshot(snapshot.checkedAt)) {
        const embedText = Array.isArray(message?.embeds)
          ? message.embeds.flatMap((embed: any) => [
              embed?.title,
              embed?.description,
              ...(Array.isArray(embed?.fields)
                ? embed.fields.flatMap((field: any) => [field?.name, field?.value])
                : []),
            ]).filter((value: unknown): value is string => typeof value === 'string').join(' ')
          : '';
        tournamentMatch = findOngoingTournamentMatchInText(
          `${String(message?.content || '')} ${embedText}`,
          snapshot.payload.ongoingTournamentMatches ?? [],
        );
      }
    } catch {
      // Missing or stale tournament data must not create an official classification.
    }

    const sourceMessageUrl = `https://discord.com/channels/${LIVE_STREAM_GUILD_ID}/${LIVE_STREAM_CHANNEL_ID}/${body.messageId}`;
    const result = await startExternalLiveBroadcast({
      ownerDiscordId: authorDiscordId,
      ownerName: String(members[0].display_name || 'Forum member'),
      stream: streams[0],
      sourceMessageUrl,
      ...(tournamentMatch
        ? { players: [tournamentMatch.first_name, tournamentMatch.second_name] as [string, string] }
        : {}),
      isWta: tournamentMatch?.tour === 'TE4_(F)',
      officialByTournament: Boolean(tournamentMatch),
    });
    return NextResponse.json(
      { id: result.id, duplicate: result.duplicate },
      { status: result.duplicate ? 200 : 201, headers: PRIVATE_HEADERS },
    );
  } catch (error) {
    console.error('[live-broadcast] automatic Discord intake failed', error instanceof Error ? error.name : 'UnknownError');
    return NextResponse.json({ error: 'Automatic stream start is temporarily unavailable.' }, { status: 503, headers: PRIVATE_HEADERS });
  }
}
