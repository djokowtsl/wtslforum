export const LIVE_STREAM_GUILD_ID = '786583939028090881';
export const LIVE_STREAM_CHANNEL_ID = '1293144531855872074';

export type LiveStream = {
  provider: 'youtube' | 'twitch' | 'twitch-clip';
  id: string;
  sourceUrl: string;
};

export type DiscordMessageReference = {
  guildId: string;
  channelId: string;
  messageId: string;
};

export function parseDiscordMessageUrl(value: string): DiscordMessageReference | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !['discord.com', 'www.discord.com'].includes(url.hostname)) return null;
    const match = url.pathname.match(/^\/channels\/(\d{17,20})\/(\d{17,20})\/(\d{17,20})\/?$/);
    if (!match || match[1] !== LIVE_STREAM_GUILD_ID || match[2] !== LIVE_STREAM_CHANNEL_ID) return null;
    return { guildId: match[1], channelId: match[2], messageId: match[3] };
  } catch {
    return null;
  }
}

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
  'youtu.be',
]);

export function parseLiveStreamUrl(value: string): LiveStream | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return null;
  const host = url.hostname.toLowerCase().replace(/\.$/, '');

  if (YOUTUBE_HOSTS.has(host)) {
    const id = host === 'youtu.be'
      ? url.pathname.split('/').filter(Boolean)[0]
      : url.searchParams.get('v')
        || url.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)/)?.[1];
    if (!id || !/^[A-Za-z0-9_-]{6,20}$/.test(id)) return null;
    return { provider: 'youtube', id, sourceUrl: url.toString() };
  }

  if (host === 'clips.twitch.tv') {
    const id = url.pathname.split('/').filter(Boolean)[0];
    if (!id || !/^[A-Za-z0-9_-]{5,64}$/.test(id)) return null;
    return { provider: 'twitch-clip', id, sourceUrl: url.toString() };
  }

  if (host === 'twitch.tv' || host === 'www.twitch.tv' || host === 'm.twitch.tv') {
    const segments = url.pathname.split('/').filter(Boolean);
    const channel = segments[0];
    if (!channel || !/^[A-Za-z0-9_]{3,25}$/.test(channel) || ['videos', 'directory', 'downloads'].includes(channel.toLowerCase())) {
      return null;
    }
    return { provider: 'twitch', id: channel.toLowerCase(), sourceUrl: url.toString() };
  }

  return null;
}

function linksInText(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  return [...value.matchAll(/https:\/\/[^\s<>"`]+/gi)]
    .map((match) => match[0].replace(/[),.!?;:'\]]+$/g, ''));
}

export function streamLinksInDiscordMessage(message: unknown): LiveStream[] {
  if (!message || typeof message !== 'object') return [];
  const record = message as {
    content?: unknown;
    embeds?: Array<{ url?: unknown; video?: { url?: unknown }; image?: { url?: unknown } }>;
  };
  const candidates = linksInText(record.content);
  for (const embed of Array.isArray(record.embeds) ? record.embeds : []) {
    candidates.push(...linksInText(embed?.url));
    candidates.push(...linksInText(embed?.video?.url));
  }

  const streams = new Map<string, LiveStream>();
  for (const candidate of candidates) {
    const stream = parseLiveStreamUrl(candidate);
    if (stream) streams.set(`${stream.provider}:${stream.id}`, stream);
  }
  return [...streams.values()];
}

export function normalizeLivePlayerName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '');
}

export function sameLiveMatch(first: [string, string] | null, second: [string, string] | null): boolean {
  if (!first || !second) return false;
  const left = first.map(normalizeLivePlayerName).sort();
  const right = second.map(normalizeLivePlayerName).sort();
  return Boolean(left[0] && left[1] && left[0] === right[0] && left[1] === right[1]);
}
