import { cookies } from 'next/headers';
import { SignJWT, jwtVerify } from 'jose';
import { sql } from './db';

const secret = new TextEncoder().encode(process.env.AUTH_SECRET || 'change-me-in-vercel');
const cookieName = 'wtsl_session';
export type SessionUser = { id:string; discordId:string; username:string; avatar:string|null; isAdmin:boolean };

export async function createSession(user: SessionUser) {
  const token = await new SignJWT(user).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('30d').sign(secret);
  const jar = await cookies();
  jar.set(cookieName, token, {httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',path:'/',maxAge:60*60*24*30});
}
export async function getSession(): Promise<SessionUser|null> {
  const token = (await cookies()).get(cookieName)?.value;
  if (!token) return null;
  try { const {payload}=await jwtVerify(token,secret); return payload as unknown as SessionUser; } catch { return null; }
}
export async function clearSession(){(await cookies()).delete(cookieName);}
export async function upsertDiscordUser(u:{id:string;username:string;global_name?:string|null;avatar?:string|null}){
  const adminIds=(process.env.ADMIN_DISCORD_IDS||'').split(',').map(x=>x.trim()).filter(Boolean);
  const isAdmin=adminIds.includes(u.id);
  const name=u.global_name || u.username;
  const rows=await sql`INSERT INTO users (discord_id,username,display_name,avatar_url,is_admin) VALUES (${u.id},${u.username},${name},${u.avatar?`https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=128`:null},${isAdmin}) ON CONFLICT (discord_id) DO UPDATE SET username=EXCLUDED.username,display_name=EXCLUDED.display_name,avatar_url=EXCLUDED.avatar_url,is_admin=EXCLUDED.is_admin,updated_at=NOW() RETURNING id,discord_id,username,avatar_url,is_admin`;
  const r=rows[0]; return {id:String(r.id),discordId:r.discord_id,username:r.username,avatar:r.avatar_url,isAdmin:Boolean(r.is_admin)} as SessionUser;
}
export function discordAvatar(url:string|null, name:string){return url || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=242a32&color=ffffff&bold=true`}
