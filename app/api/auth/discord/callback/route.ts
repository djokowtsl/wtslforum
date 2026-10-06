import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { upsertDiscordUser, createSession, authConfigured } from '@/lib/auth';
import { syncBotApprovedIdentitiesForUser } from '@/lib/matchlog-identity-sync';

export const dynamic = 'force-dynamic';

const go = (url: URL, err: string) => NextResponse.redirect(new URL(`/?error=${err}`, url));

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get('error')) return go(url, 'discord_cancelled');
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const jar = await cookies();
  if (!code || !state || state !== jar.get('wtsl_oauth_state')?.value) return go(url, 'discord_auth');
  if (!authConfigured()) return go(url, 'auth_secret');

  const redirect = process.env.DISCORD_REDIRECT_URI || `${url.origin}/api/auth/discord/callback`;
  try {
    const token = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: process.env.DISCORD_CLIENT_ID || '', client_secret: process.env.DISCORD_CLIENT_SECRET || '', grant_type: 'authorization_code', code, redirect_uri: redirect }),
    });
    if (!token.ok) {
      console.error('[wtsl] Discord token exchange failed', token.status, await token.text().catch(() => ''));
      return go(url, 'discord_token');
    }
    const td = await token.json();
    const me = await fetch('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${td.access_token}` } });
    if (!me.ok) return go(url, 'discord_user');
    const user = await upsertDiscordUser(await me.json());
    await createSession(user);
    try {
      const synced = await syncBotApprovedIdentitiesForUser(user.id, user.discordId);
      if (synced.length) {
        console.info(`[wtsl] synced ${synced.length} approved player identity(ies) after Discord login`);
      }
    } catch (syncError) {
      // Identity sync is best-effort for sign-in. The approved bot record remains durable,
      // so the next Discord login can retry without blocking the user's forum session.
      console.error(
        '[wtsl] approved player identity sync after Discord login failed',
        syncError instanceof Error ? syncError.message : syncError,
      );
    }
  } catch (e) {
    console.error('[wtsl] Discord callback failed', e instanceof Error ? e.message : e);
    return go(url, 'database');
  }
  jar.delete('wtsl_oauth_state');
  return NextResponse.redirect(new URL('/profile', url));
}
