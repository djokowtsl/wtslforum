import { after } from 'next/server';
import {
  deleteLiveBroadcastAnnouncement,
  markLiveBroadcastAnnouncementEnded,
  type LiveBroadcastAnnouncementReference,
} from '@/lib/discord';

const ANNOUNCEMENT_DELETE_DELAY_MS = 60_000;

type StoredBroadcast = Record<string, unknown> & {
  discordAnnouncement?: unknown;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseAnnouncementReference(value: unknown): LiveBroadcastAnnouncementReference | null {
  if (!isObject(value)) return null;
  const channelId = value.channelId;
  const messageId = value.messageId;
  if (typeof channelId !== 'string' || !channelId || typeof messageId !== 'string' || !messageId) {
    return null;
  }
  return { channelId, messageId };
}

function parsePlayers(value: unknown): [string, string] | null {
  if (
    !Array.isArray(value)
    || value.length !== 2
    || value.some((name) => typeof name !== 'string')
  ) {
    return null;
  }
  return [value[0], value[1]];
}

function parseStream(value: unknown): { provider: string; sourceUrl: string } | null {
  if (
    !isObject(value)
    || typeof value.provider !== 'string'
    || typeof value.sourceUrl !== 'string'
  ) {
    return null;
  }
  return { provider: value.provider, sourceUrl: value.sourceUrl };
}

/** Edits a broadcast's Discord post now and schedules its deletion one minute later. */
export async function finishLiveBroadcastAnnouncement(input: {
  id: string;
  ownerDiscordId: string;
  payload: unknown;
}): Promise<void> {
  if (!isObject(input.payload)) return;
  const payload = input.payload as StoredBroadcast;
  const reference = parseAnnouncementReference(payload.discordAnnouncement);
  if (!reference) return;

  const bestOf = payload.bestOf === 1 || payload.bestOf === 5 ? payload.bestOf : 3;
  await markLiveBroadcastAnnouncementEnded({
    id: input.id,
    ownerDiscordId: input.ownerDiscordId,
    ownerName: typeof payload.ownerName === 'string' ? payload.ownerName : 'Forum member',
    players: parsePlayers(payload.players),
    bestOf,
    isWta: payload.isWta === true,
    officialByBroadcaster: payload.officialByBroadcaster === true,
    likelyOfficial: payload.likelyOfficial === true,
    stream: parseStream(payload.stream),
    reference,
  });

  const deleteAt = Date.now() + ANNOUNCEMENT_DELETE_DELAY_MS;
  after(async () => {
    const remainingMs = Math.max(0, deleteAt - Date.now());
    if (remainingMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, remainingMs));
    }
    await deleteLiveBroadcastAnnouncement(reference);
  });
}
