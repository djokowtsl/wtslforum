# WTSL Community — go-live checklist

The site now stays up and explains what is missing instead of crashing. Work through these in order.

## 1. Database (fixes empty Discussions / Articles / Tournaments / Players / Awards)
1. In Vercel → Project → Settings → Environment Variables, add `DATABASE_URL` (Neon connection string).
2. Open the Neon SQL editor and run the whole of `db.sql` once (it is safe to re-run).
3. Redeploy.

## 2. Sessions
Add `AUTH_SECRET` (any long random string, e.g. `openssl rand -base64 32`). In production the site refuses to create sessions without it.

## 3. Discord sign-in
1. https://discord.com/developers/applications → your application → **OAuth2**.
2. Under **Redirects**, add exactly: `https://wtslforum.vercel.app/api/auth/discord/callback` and save.
3. Copy **Client ID** and **Client Secret** into Vercel as `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET`.
4. Add `DISCORD_REDIRECT_URI` with the same redirect URL as step 2 (must match character for character — no trailing slash).
5. Add `ADMIN_DISCORD_IDS` with your Discord user ID (Discord → Settings → Advanced → Developer Mode, then right-click yourself → Copy User ID). Sign out and back in to become admin.
6. Optional: add `MODERATOR_DISCORD_IDS` as a comma-separated list of Discord user IDs. These accounts can delete comments only; they cannot edit other members' comments, manage topics, or use admin tools. Remove an ID and redeploy to revoke access.
7. Redeploy. If sign-in fails, the homepage now shows which step went wrong.

## 4. Tournaments and players
Add `CRON_SECRET` (Vercel calls `/api/sync/wtsl` hourly with it). The sync now does two things: loads **every player** from the WTSL rankings page (rank, Tour Elo, flag, avatar — refreshed each run), then the tournament calendar (champions included). Each new tournament gets its own discussion thread.

To run it immediately, add `WTSL_SYNC_SECRET` and call:
`curl -H "x-wtsl-sync-secret: <secret>" https://wtslforum.vercel.app/api/sync/wtsl`
The response reports `players.upserted` and `tournaments.created/updated`.

**If players come back empty or wrong**, call the same URL with `?debug=1`. It shows the HTTP status, how many table rows were found, what the parser extracted, and the raw HTML of the first rows — send that to whoever maintains the parser and it can be matched exactly to the page.

## 5. Live fixtures and results
Add `WTSL_CORE_API_URL` and `WTSL_CORE_API_KEY` for open fixtures/odds. The "Latest results" blocks read the `match_stats` table, which must be populated by the WTSL bot / sync worker.

## 6. Awards
Winners are read from the `awards` table, e.g.
`INSERT INTO awards(season,category,winner,runner_up,note) VALUES ('Season 1','Player of the Year','Name','Name','Why they won');`

## Branding
Official logo assets are in `public/brand/` (`wtsl-logo-original.png` is your untouched upload). `app/icon.png`, `app/apple-icon.png` and `app/opengraph-image.png` (Discord/social link preview) are generated from it.
