const api='https://discord.com/api/v10';
async function send(channelId:string,content:string){const token=process.env.DISCORD_BOT_TOKEN;if(!token||!channelId)return;await fetch(`${api}/channels/${channelId}/messages`,{method:'POST',headers:{Authorization:`Bot ${token}`,'Content-Type':'application/json'},body:JSON.stringify({content})});}
export async function announceTopic(title:string,id:number,author:string){await send(process.env.DISCORD_FORUM_CHANNEL_ID||'',`🎾 **New WTSL discussion:** ${title}\nStarted by **${author}**\n${process.env.NEXT_PUBLIC_SITE_URL||''}/discussions/${id}`)}
export async function announceArticle(title:string,id:number,author:string){await send(process.env.DISCORD_ARTICLES_CHANNEL_ID||'',`📰 **New WTSL Forum article:** ${title}\nBy **${author}**\n${process.env.NEXT_PUBLIC_SITE_URL||''}/articles/${id}`)}
export async function announceMod(message:string){await send(process.env.DISCORD_MOD_CHANNEL_ID||'',`🛡️ **WTSL Forum moderation**\n${message}`)}

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
  await sendDM(discordUserId,`✅ **You're verified!** Your WTSL Forum account is now linked to Challonge username **${username}** — the predictions leaderboard will now show your official name.`);
}

