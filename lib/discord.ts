const api='https://discord.com/api/v10';
async function send(channelId:string,content:string){const token=process.env.DISCORD_BOT_TOKEN;if(!token||!channelId)return;await fetch(`${api}/channels/${channelId}/messages`,{method:'POST',headers:{Authorization:`Bot ${token}`,'Content-Type':'application/json'},body:JSON.stringify({content})});}
export async function announceTopic(title:string,id:number,author:string){await send(process.env.DISCORD_FORUM_CHANNEL_ID||'',`🎾 **New WTSL discussion:** ${title}\nStarted by **${author}**\n${process.env.NEXT_PUBLIC_SITE_URL||''}/discussions/${id}`)}
export async function announceArticle(title:string,id:number,author:string){await send(process.env.DISCORD_ARTICLES_CHANNEL_ID||'',`📰 **New WTSL Forum article:** ${title}\nBy **${author}**\n${process.env.NEXT_PUBLIC_SITE_URL||''}/articles/${id}`)}
export async function announceMod(message:string){await send(process.env.DISCORD_MOD_CHANNEL_ID||'',`🛡️ **WTSL Forum moderation**\n${message}`)}
