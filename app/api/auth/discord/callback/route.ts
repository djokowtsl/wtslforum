import { NextResponse } from 'next/server'; import { cookies } from 'next/headers'; import { upsertDiscordUser,createSession } from '@/lib/auth';
export async function GET(req:Request){
 const url=new URL(req.url); const code=url.searchParams.get('code'); const state=url.searchParams.get('state'); const jar=await cookies();
 if(!code || !state || state!==jar.get('wtsl_oauth_state')?.value) return NextResponse.redirect(new URL('/?error=discord_auth',url));
 const redirect=process.env.DISCORD_REDIRECT_URI || `${url.origin}/api/auth/discord/callback`;
 const token=await fetch('https://discord.com/api/oauth2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:process.env.DISCORD_CLIENT_ID||'',client_secret:process.env.DISCORD_CLIENT_SECRET||'',grant_type:'authorization_code',code,redirect_uri:redirect})});
 if(!token.ok) return NextResponse.redirect(new URL('/?error=discord_token',url)); const td=await token.json();
 const me=await fetch('https://discord.com/api/users/@me',{headers:{Authorization:`Bearer ${td.access_token}`}}); if(!me.ok) return NextResponse.redirect(new URL('/?error=discord_user',url));
 const d=await me.json(); const user=await upsertDiscordUser(d); await createSession(user); jar.delete('wtsl_oauth_state'); return NextResponse.redirect(new URL('/profile',url));
}
