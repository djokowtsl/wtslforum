# Deployment

## 1. Database
Create a Neon PostgreSQL database and run `db.sql` once. Copy its connection string into `DATABASE_URL`.

## 2. Discord OAuth
Create a Discord Developer Application. Add the Vercel callback URL:
`https://YOUR-DOMAIN.vercel.app/api/auth/discord/callback`

Set `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_REDIRECT_URI`, `AUTH_SECRET`, and `ADMIN_DISCORD_IDS` in Vercel.

## 3. Vercel
Import the repository, set the environment variables, and deploy. Do not prefix secrets with `NEXT_PUBLIC_`.

## 4. Bot
The Discord bot in `/bot` is intentionally separate from Vercel. Install its dependencies and set its `.env` values. Deploy it to an always-on Node host. It registers `/forum`, `/article`, and `/discussions` in the configured guild.

## 5. Admin
Put your Discord user ID in `ADMIN_DISCORD_IDS`. Multiple IDs are comma-separated.

## 6. Next phase
Add webhook/API credentials to let the bot announce new articles/discussions and allow WTSL match/event feeds to create links back to forum threads.

## WTSL tournament bridge

The forum now has a WTSL tournament sync. It reads the public TE4 tournament page and stores a snapshot in the forum database. The sync creates a community discussion automatically for each tournament it discovers, then updates status/champion information as the WTSL page changes.

Set `WTSL_SYNC_SECRET` in Vercel. The API route accepts that secret via the `x-wtsl-sync-secret` header. If your Vercel plan supports the included cron, `vercel.json` runs the sync hourly. The Discord bot can also call the same endpoint.

Player identity is designed to use the official WTSL player page as its source for WTSL avatar, nationality/flag, ranking and Tour Elo. Discord avatars remain the community-account identity and are separate from the WTSL player identity.
