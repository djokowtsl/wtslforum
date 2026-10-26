import { randomUUID } from 'node:crypto';
import { sql } from '@/lib/db';
import { cleanupExpiredLiveDmoBroadcasts } from '@/lib/liveDmoStorage';
import { announceLiveBroadcast } from '@/lib/discord';
import { finishLiveBroadcastAnnouncement } from '@/lib/liveBroadcastAnnouncements';
import type { LiveStream } from '@/lib/liveBroadcast';

export async function startExternalLiveBroadcast(input: {
  ownerDiscordId: string;
  ownerName: string;
  stream: LiveStream;
  sourceMessageUrl?: string | null;
  players?: [string, string] | null;
  character?: string | null;
  bestOf?: 1 | 3 | 5;
  isWta?: boolean;
  officialByBroadcaster?: boolean;
  likelyOfficial?: boolean;
}) {
  await cleanupExpiredLiveDmoBroadcasts();

  const id = randomUUID();
  const bestOf = input.bestOf ?? 3;
  const isWta = input.isWta ?? false;
  const officialByBroadcaster = input.officialByBroadcaster ?? false;
  const likelyOfficial = input.likelyOfficial ?? false;
  const payload = {
    hasDmo: false,
    mode: 'manual',
    replay: false,
    replaySpeed: 1,
    bestOf,
    ownerName: input.ownerName.slice(0, 100),
    isWta,
    officialByBroadcaster,
    likelyOfficial,
    stream: input.stream,
    ...(input.character ? { character: input.character } : {}),
    ...(input.sourceMessageUrl ? { sourceMessageUrl: input.sourceMessageUrl } : {}),
    ...(input.players ? { players: input.players } : {}),
  };
  const lockKey = `${input.ownerDiscordId}:${input.stream.provider}:${input.stream.id}`;
  const rows = await sql`
    WITH broadcast_lock AS MATERIALIZED (
      SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))
    ),
    existing AS MATERIALIZED (
      SELECT broadcast.id
      FROM dmo_live_broadcasts AS broadcast
      CROSS JOIN broadcast_lock
      WHERE broadcast.owner_discord_id=${input.ownerDiscordId}
        AND broadcast.status='live'
        AND broadcast.expires_at > NOW()
        AND broadcast.payload->'stream'->>'provider'=${input.stream.provider}
        AND broadcast.payload->'stream'->>'id'=${input.stream.id}
      ORDER BY broadcast.started_at DESC
      LIMIT 1
    ),
    created AS (
      INSERT INTO dmo_live_broadcasts
        (id, owner_discord_id, status, sequence, payload, started_at, updated_at, expires_at)
      SELECT
        ${id}::uuid,
        ${input.ownerDiscordId},
        'live',
        0,
        ${JSON.stringify(payload)}::jsonb,
        NOW(),
        NOW(),
        NOW() + INTERVAL '4 hours'
      FROM broadcast_lock
      WHERE NOT EXISTS (SELECT 1 FROM existing)
      RETURNING id
    )
    SELECT id, TRUE AS duplicate FROM existing
    UNION ALL
    SELECT id, FALSE AS duplicate FROM created
    LIMIT 1
  `;
  if (!rows[0]?.id) throw new Error('External stream broadcast could not be stored.');
  const broadcastId = String(rows[0].id);
  const duplicate = Boolean(rows[0].duplicate);
  if (duplicate) {
    if (input.character) {
      await sql`
        UPDATE dmo_live_broadcasts
        SET payload=COALESCE(payload, '{}'::jsonb)
              || jsonb_build_object('character', ${input.character})
        WHERE id=${broadcastId}::uuid
          AND owner_discord_id=${input.ownerDiscordId}
          AND status='live'
          AND expires_at > NOW()
      `;
    }
    return { id: broadcastId, duplicate: true };
  }

  try {
    const announcement = await announceLiveBroadcast({
      id: broadcastId,
      ownerDiscordId: input.ownerDiscordId,
      ownerName: payload.ownerName,
      players: input.players ?? null,
      bestOf,
      isWta,
      officialByBroadcaster,
      likelyOfficial,
      stream: input.stream,
    }, {
      // Keep ordinary intake pings in their source channel. Official matches
      // use the player-facing WTSL Live Streams announcement instead.
      pingViewerRoleInSource: !officialByBroadcaster && !likelyOfficial,
    });

    if (announcement) {
      try {
        const saved = await sql`
          UPDATE dmo_live_broadcasts
          SET payload=COALESCE(payload, '{}'::jsonb)
                || jsonb_build_object('discordAnnouncement', ${JSON.stringify(announcement)}::jsonb)
          WHERE id=${broadcastId}::uuid
          RETURNING owner_discord_id, status, payload
        `;
        if (saved[0]?.status === 'ended') {
          await finishLiveBroadcastAnnouncement({
            id: broadcastId,
            ownerDiscordId: String(saved[0].owner_discord_id || input.ownerDiscordId),
            payload: saved[0].payload,
          });
        }
      } catch (error) {
        console.warn(
          '[live-broadcast] external announcement reference could not be saved',
          error instanceof Error ? error.name : 'UnknownError',
        );
      }
    }
  } catch (error) {
    console.warn('[live-broadcast] external announcement delivery failed', error instanceof Error ? error.message : 'UnknownError');
  }

  return { id: broadcastId, duplicate: false };
}
