import { NextResponse } from 'next/server';
export async function GET(req:Request){
 const u=new URL(req.url); const state=crypto.randomUUID();
 const redirect=process.env.DISCORD_REDIRECT_URI || `${u.origin}/api/auth/discord/callback`;
 const p=new URLSearchParams({client_id:process.env.DISCORD_CLIENT_ID||'',redirect_uri:redirect,response_type:'code',scope:'identify',state});
 const res=NextResponse.redirect(`https://discord.com/oauth2/authorize?${p}`);
 res.cookies.set('wtsl_oauth_state',state,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',path:'/',maxAge:600}); return res;
}
