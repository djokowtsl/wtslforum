const api='https://discord.com/api/v10';
const FORUM_ARTICLES_CHANNEL_ID='1556169407011491901';
const ADMIN_THREADS_CHANNEL_ID='801907383055810638';

function forumSiteUrl(){return (process.env.NEXT_PUBLIC_SITE_URL||'https://www.wtslforum.com').replace(/\/+$/,'');}

async function send(channelId:string,content:string){
  const token=process.env.DISCORD_BOT_TOKEN;
  if(!token){console.warn('[forum-discord] announcement skipped: bot token is not configured');return;}
  if(!channelId){console.warn('[forum-discord] announcement skipped: channel is not configured');return;}
  try{
    const response=await fetch(`${api}/channels/${channelId}/messages`,{
      method:'POST',
      headers:{Authorization:`Bot ${token}`,'Content-Type':'application/json'},
      body:JSON.stringify({content,allowed_mentions:{parse:[]}}),
      signal:AbortSignal.timeout(5_000),
    });
    if(!response.ok)console.warn(`[forum-discord] message delivery failed (HTTP ${response.status})`);
  }catch(error){
    console.warn('[forum-discord] message delivery failed',error instanceof Error?error.message:'UnknownError');
  }
}

export async function announceTopic(title:string,id:number,author:string){
  await send(process.env.DISCORD_FORUM_CHANNEL_ID||'',`🎾 **New WTSL discussion:** ${title}\nStarted by **${author}**\n${forumSiteUrl()}/discussions/${id}`);
}

export async function announceAdminTopic(title:string,id:number,author:string){
  await send(ADMIN_THREADS_CHANNEL_ID,`🎾 **New WTSL Forum thread:** ${title}\nStarted by **${author}**\n${forumSiteUrl()}/discussions/${id}`);
}

export async function announceArticle(title:string,slug:string|number,author:string){
  await send(FORUM_ARTICLES_CHANNEL_ID,`📰 **New WTSL Forum article:** ${title}\nBy **${author}**\n${forumSiteUrl()}/articles/${slug}`);
}
export async function announceMod(message:string){await send(process.env.DISCORD_MOD_CHANNEL_ID||'',`🛡️ **WTSL Forum moderation**\n${message}`)}

const LIVE_STREAMS_CHANNEL_ID = '1562898541238554765';
const RECENT_LIVE_ROLE_PINGS_CHANNEL_ID = '1293144531855872074';
const LIVE_STREAM_ROLE_ID = '1439615663860879501';
const DISCORD_REQUEST_TIMEOUT_MS = 5_000;

type LiveBroadcastAnnouncement = {
  id: string;
  ownerDiscordId: string;
  ownerName: string;
  players?: [string, string] | null;
  bestOf: 1 | 3 | 5;
  broadcastMode?: 'auto' | 'manual';
  isWta: boolean;
  officialByBroadcaster: boolean;
  officialByTournament?: boolean;
  likelyOfficial: boolean;
  stream?: { provider: string; sourceUrl: string } | null;
};

type LiveBroadcastAnnouncementOptions = {
  pingViewerRoleInSource?: boolean;
};

export type LiveBroadcastAnnouncementReference = {
  channelId: string;
  messageId: string;
};

function liveBroadcastEmbed(input: LiveBroadcastAnnouncement, ended = false) {
  const playerNames = input.players?.map((name) => name.slice(0, 100));
  const matchName = playerNames?.length === 2 ? `${playerNames[0]} vs ${playerNames[1]}` : null;
  const streamUrl = input.stream?.sourceUrl;
  const streamProvider = input.stream?.provider;
  const officialLabel = input.officialByBroadcaster || input.officialByTournament
    ? 'Official match'
    : input.likelyOfficial
      ? 'Likely official match'
      : null;
  const fields = [
    ...(matchName ? [{ name: 'Match', value: matchName, inline: false }] : []),
    ...(matchName ? [{ name: 'Tour', value: input.isWta ? 'WTA' : 'ATP', inline: true }] : []),
    ...(matchName ? [{ name: 'Format', value: `Best of ${input.bestOf}`, inline: true }] : []),
    ...(officialLabel ? [{ name: 'Match status', value: officialLabel, inline: true }] : []),
    ...(streamUrl
      ? [{ name: 'Stream', value: `[Watch on ${streamProvider === 'twitch' || streamProvider === 'twitch-clip' ? 'Twitch' : 'YouTube'}](${streamUrl})`, inline: false }]
      : []),
  ];
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || 'https://www.wtslforum.com').replace(/\/+$/, '');
  const broadcastUrl = `${siteUrl}/livestreams?broadcast=${encodeURIComponent(input.id)}#broadcast-${encodeURIComponent(input.id)}`;
  const broadcastTitle = matchName || `${input.ownerName.slice(0, 100)} is live`;

  return {
    title: `📺 Watch: ${broadcastTitle}`,
    url: broadcastUrl,
    description: ended
      ? 'This broadcast has ended. This announcement will be removed in one minute.'
      : 'A live match broadcast has started on the WTSL Forum.',
    color: ended ? 0x6b7280 : 0x22c55e,
    fields,
    timestamp: new Date().toISOString(),
  };
}

function roleWasPingedRecently(messages: unknown, now: number): boolean {
  if (!Array.isArray(messages)) return false;
  return messages.some((message: any) => {
    const timestamp = Date.parse(String(message?.timestamp ?? ''));
    const age = now - timestamp;
    const hasRoleMention = Array.isArray(message?.mention_roles)
      && message.mention_roles.some((roleId: unknown) => String(roleId) === LIVE_STREAM_ROLE_ID);
    const hasRoleText = typeof message?.content === 'string'
      && message.content.includes(`<@&${LIVE_STREAM_ROLE_ID}>`);
    return age >= 0 && age < 60_000 && (hasRoleMention || hasRoleText);
  });
}

/** Posts one live-stream announcement. Discord failures never prevent a broadcast from starting. */
export async function announceLiveBroadcast(
  input: LiveBroadcastAnnouncement,
  options: LiveBroadcastAnnouncementOptions = {},
): Promise<LiveBroadcastAnnouncementReference | null> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    console.warn('[live-broadcast] Discord announcement skipped: bot token is not configured');
    return null;
  }

  const isOfficialMatch = input.broadcastMode === 'auto'
    || input.officialByBroadcaster
    || input.officialByTournament;
  const shouldConsiderRolePing = options.pingViewerRoleInSource
    || isOfficialMatch
    || input.likelyOfficial;
  let includeRolePing = false;
  let includeSourceRolePing = false;
  if (shouldConsiderRolePing) {
    try {
      const recentMessagesResponse = await fetch(
        `${api}/channels/${RECENT_LIVE_ROLE_PINGS_CHANNEL_ID}/messages?limit=100`,
        {
          headers: { Authorization: `Bot ${token}` },
          cache: 'no-store',
          signal: AbortSignal.timeout(DISCORD_REQUEST_TIMEOUT_MS),
        },
      );
      if (!recentMessagesResponse.ok) {
        throw new Error(`Discord history request failed (HTTP ${recentMessagesResponse.status}).`);
      }
      const recentMessages = await recentMessagesResponse.json();
      const roleWasRecentlyPinged = roleWasPingedRecently(recentMessages, Date.now());
      if (options.pingViewerRoleInSource) {
        includeSourceRolePing = !roleWasRecentlyPinged;
      } else {
        includeRolePing = !roleWasRecentlyPinged;
      }
    } catch (error) {
      console.warn(
        '[live-broadcast] recent role-ping check failed; sending without the role mention',
        error instanceof Error ? error.message : 'UnknownError',
      );
    }
  }

  if (includeSourceRolePing) {
    const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || 'https://www.wtslforum.com').replace(/\/+$/, '');
    const broadcastUrl = `${siteUrl}/livestreams?broadcast=${encodeURIComponent(input.id)}#broadcast-${encodeURIComponent(input.id)}`;
    try {
      const response = await fetch(`${api}/channels/${RECENT_LIVE_ROLE_PINGS_CHANNEL_ID}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bot ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content: `📺 <@&${LIVE_STREAM_ROLE_ID}> A Forum member started a live stream: ${broadcastUrl}`,
          allowed_mentions: { parse: [], users: [], roles: [LIVE_STREAM_ROLE_ID] },
        }),
        signal: AbortSignal.timeout(DISCORD_REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error(`Discord viewer notification failed (HTTP ${response.status}).`);
      }
    } catch (error) {
      console.warn(
        '[live-broadcast] source-channel viewer notification failed',
        error instanceof Error ? error.message : 'UnknownError',
      );
    }
  }

  const content = `<@${input.ownerDiscordId}> is streaming now${includeRolePing ? ` <@&${LIVE_STREAM_ROLE_ID}>` : ''}`;

  try {
    const response = await fetch(`${api}/channels/${LIVE_STREAMS_CHANNEL_ID}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bot ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        content,
        embeds: [liveBroadcastEmbed(input)],
        allowed_mentions: {
          parse: [],
          users: [input.ownerDiscordId],
          roles: includeRolePing ? [LIVE_STREAM_ROLE_ID] : [],
        },
      }),
      signal: AbortSignal.timeout(DISCORD_REQUEST_TIMEOUT_MS),
    });
    const message = await response.json().catch(() => null);
    if (!response.ok || !message?.id) {
      throw new Error(`Discord announcement failed (HTTP ${response.status}).`);
    }
    return { channelId: LIVE_STREAMS_CHANNEL_ID, messageId: String(message.id) };
  } catch (error) {
    console.warn(
      '[live-broadcast] Discord announcement failed',
      error instanceof Error ? error.message : 'UnknownError',
    );
    return null;
  }
}

/** Marks the original announcement as ended without sending another mention. */
export async function markLiveBroadcastAnnouncementEnded(input: LiveBroadcastAnnouncement & {
  reference: LiveBroadcastAnnouncementReference;
}): Promise<void> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    console.warn('[live-broadcast] cannot mark announcement ended: bot token is not configured');
    return;
  }
  try {
    const response = await fetch(
      `${api}/channels/${input.reference.channelId}/messages/${input.reference.messageId}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bot ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content: '⏹️ **Broadcast ended**',
          embeds: [liveBroadcastEmbed(input, true)],
          allowed_mentions: { parse: [], users: [], roles: [] },
        }),
        signal: AbortSignal.timeout(DISCORD_REQUEST_TIMEOUT_MS),
      },
    );
    if (!response.ok) {
      throw new Error(`Discord announcement edit failed (HTTP ${response.status}).`);
    }
  } catch (error) {
    console.warn(
      '[live-broadcast] could not mark announcement ended',
      error instanceof Error ? error.message : 'UnknownError',
    );
  }
}

/** Deletes the ended announcement after its one-minute notice period. */
export async function deleteLiveBroadcastAnnouncement(
  reference: LiveBroadcastAnnouncementReference,
): Promise<void> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    console.warn('[live-broadcast] cannot delete announcement: bot token is not configured');
    return;
  }
  try {
    const response = await fetch(
      `${api}/channels/${reference.channelId}/messages/${reference.messageId}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bot ${token}` },
        signal: AbortSignal.timeout(DISCORD_REQUEST_TIMEOUT_MS),
      },
    );
    if (!response.ok && response.status !== 404) {
      throw new Error(`Discord announcement deletion failed (HTTP ${response.status}).`);
    }
  } catch (error) {
    console.warn(
      '[live-broadcast] could not delete ended announcement',
      error instanceof Error ? error.message : 'UnknownError',
    );
  }
}

/** Opens (or reuses) a DM channel with a Discord user and sends them a message. Never throws —
 * a user can have DMs disabled, and that should never block whatever triggered the notification. */
export async function sendDM(discordUserId:string,content:string){
  const token=process.env.DISCORD_BOT_TOKEN;
  if(!token||!discordUserId)return;
  try{
    const dm=await fetch(`${api}/users/@me/channels`,{method:'POST',headers:{Authorization:`Bot ${token}`,'Content-Type':'application/json'},body:JSON.stringify({recipient_id:discordUserId})});
    if(!dm.ok)return;
    const channel=await dm.json();
    if(channel?.id)await send(channel.id,content);
  }catch{
    // best-effort only
  }
}

export async function notifyPlayerVerified(discordUserId:string,playerName:string,tour:string){
  await sendDM(discordUserId,`✅ **You're verified!** Your WTSL Forum account is now linked to **${playerName}** (${tour}). Check out your player dashboard any time from your profile.`);
}

export async function notifyChallongeVerified(discordUserId:string,username:string){
  await sendDM(discordUserId,`✅ **You're verified!** Your WTSL Forum account is now linked to Challonge username **${username}** — the predictions leaderboard will now show your name.`);
}

export async function sendDmoSubmission(input: {
  submitterName: string;
  tournament: string;
  roundName: string;
  player1: string;
  player2: string;
  externalUrl?: string | null;
  file?: Blob | null;
  fileName?: string | null;
}): Promise<{ channelId: string; messageId: string }> {
  const token = process.env.DISCORD_BOT_TOKEN;
  // Keep this in sync with DMO_ADMIN_CHANNEL_ID in the Discord bot workspace.
  const channelId = '1055277431398866995';
  if (!token) throw new Error('Discord delivery is not configured.');

  const content = [
    '📼 **Match Recording Submitted**',
    `**From:** ${input.submitterName} (Forum)`,
    `**Tournament:** ${input.tournament}`,
    `**Round:** ${input.roundName}`,
    `**Players:** ${input.player1} vs ${input.player2}`,
    input.fileName ? `**File:** ${input.fileName}` : null,
    input.externalUrl ? `**Link:** ${input.externalUrl}` : null,
  ].filter(Boolean).join('\n').slice(0, 1900);
  const payload = { content, allowed_mentions: { parse: [] } };
  const headers: Record<string, string> = { Authorization: `Bot ${token}` };
  let body: BodyInit;

  if (input.file) {
    const form = new FormData();
    form.set('payload_json', JSON.stringify(payload));
    form.set(
      'files[0]',
      input.file,
      (input.fileName || 'match-recording.dmo').slice(0, 120),
    );
    body = form;
  } else {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(payload);
  }

  const response = await fetch(`${api}/channels/${channelId}/messages`, {
    method: 'POST',
    headers,
    body,
  });
  const message = await response.json().catch(() => null);
  if (!response.ok || !message?.id) {
    throw new Error(`Discord delivery failed (HTTP ${response.status}).`);
  }
  return { channelId, messageId: String(message.id) };
}

