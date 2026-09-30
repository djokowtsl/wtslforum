import 'dotenv/config';
import {Client,GatewayIntentBits,REST,Routes,ChatInputCommandInteraction,EmbedBuilder} from 'discord.js';
const token=process.env.DISCORD_BOT_TOKEN!; const clientId=process.env.DISCORD_CLIENT_ID!; const guildId=process.env.DISCORD_GUILD_ID!; const forum=process.env.FORUM_URL||'';
const commands=[{name:'forum',description:'Open the WTSL Community Forum'},{name:'article',description:'Open the latest WTSL community articles'},{name:'discussions',description:'Open WTSL community discussions'},{name:'tournaments',description:'Open WTSL tournament discussions'},{name:'stats',description:'Open the WTSL stats centre'},{name:'dashboard',description:'Open the WTSL community dashboard'},{name:'betting',description:'Open WTSL virtual betting'}];
const rest=new REST({version:'10'}).setToken(token); if(token&&clientId&&guildId) await rest.put(Routes.applicationGuildCommands(clientId,guildId),{body:commands});
const client=new Client({intents:[GatewayIntentBits.Guilds]});
async function syncWTSL(){const base=process.env.WEBSITE_SYNC_URL; const secret=process.env.WTSL_SYNC_SECRET; if(!base||!secret)return; try{const r=await fetch(base,{headers:{'x-wtsl-sync-secret':secret}}); console.log('WTSL sync',r.status,await r.text())}catch(e){console.error('WTSL sync failed',e)}}
client.once('ready',async()=>{console.log(`WTSL Community Bot online as ${client.user?.tag}`); await syncWTSL(); setInterval(syncWTSL,60*60*1000);});
client.on('interactionCreate',async (i)=>{if(!i.isChatInputCommand())return; const paths:{[k:string]:string}={forum:'/',article:'/articles',discussions:'/discussions',tournaments:'/tournaments'}; await i.reply({content:`🎾 WTSL Community: ${forum}${paths[i.commandName]||''}`,ephemeral:true});});
client.login(token);
export async function sendAnnouncement(channelId:string,title:string,description:string,url:string){const ch=await client.channels.fetch(channelId);if(!ch?.isTextBased())return;const embed=new EmbedBuilder().setTitle(title).setDescription(description).setURL(url).setFooter({text:'WTSL Community'});await ch.send({embeds:[embed]});}


