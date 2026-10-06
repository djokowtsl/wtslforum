# Deployment

## 1. Database
Create a Neon PostgreSQL database and run `db.sql` once. Copy its connection string into `DATABASE_URL`. For an existing database, run `migrations/2026-10-02-default-player-claim.sql`, `migrations/2026-10-03-forum-moderation.sql`, `migrations/2026-10-03-tournament-discussion-recreation.sql`, and `migrations/2026-10-04-interview-transcript-idempotency.sql` before deploying. The interview-transcript migration adds the `source_key` columns and unique indexes required for idempotent Discord transcript sync.

## 2. Discord OAuth
Create a Discord Developer Application. Add the Vercel callback URL:
`https://YOUR-DOMAIN.vercel.app/api/auth/discord/callback`

Set `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_REDIRECT_URI`, `AUTH_SECRET`, `ADMIN_DISCORD_IDS`, `MODERATOR_DISCORD_IDS`, and `OPENAI_API_KEY` in Vercel. The Discord ID lists remain bootstrap paths; account-assigned roles are stored in the database. Keep provider keys server-side.

## 3. Vercel
Import the repository, set the environment variables, and deploy. Do not prefix secrets with `NEXT_PUBLIC_`.

## 4. Bot
The Discord bot in `/bot` is intentionally separate from Vercel. Install its dependencies and set its `.env` values. Deploy it to an always-on Node host. It registers `/forum`, `/article`, and `/discussions` in the configured guild.

## 5. Admin
Put your Discord user ID in `ADMIN_DISCORD_IDS`. Multiple IDs are comma-separated. Assign additional admins and moderators from the forum's account roles page.

## 6. Next phase
Add webhook/API credentials to let the bot announce new articles/discussions and allow WTSL match/event feeds to create links back to forum threads.

## Moderation and community notes
Create a private Vercel Blob store and connect it to the website project. Set `MODERATION_BLOB_STORE_ID` to that store's ID. Uploaded videos, external clips, and uncertain text/image results wait for moderator approval; pending uploads remain private until approved.

## WTSL tournament bridge

The forum now has a WTSL tournament sync. It reads the public TE4 tournament page and stores a snapshot in the forum database. The sync creates a community discussion automatically for each tournament it discovers, then updates status/champion information as the WTSL page changes.

Set `WTSL_SYNC_SECRET` in Vercel. The API route accepts that secret via the `x-wtsl-sync-secret` header. If your Vercel plan supports the included cron, `vercel.json` runs the sync hourly. The Discord bot can also call the same endpoint.

Player identity is designed to use the official WTSL player page as its source for WTSL avatar, nationality/flag, ranking and Tour Elo. Discord avatars remain the community-account identity and are separate from the WTSL player identity.
