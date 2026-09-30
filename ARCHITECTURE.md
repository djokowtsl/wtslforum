# WTSL Community Architecture

The forum is intentionally independent from the official WTSL database.

## Website
Next.js/Vercel handles pages, Discord OAuth, sessions, forum CRUD, articles and moderation. Neon/Postgres stores community data.

## Discord
`/bot` is a separate Node/discord.js service. It should run on a small always-on host (Railway, Render, Fly.io, VPS, etc.), because Vercel functions are not intended to be persistent Discord gateway processes.

The bot owns Discord gateway events and slash commands. The website owns the forum database and authentication. Webhooks/API endpoints can connect the two without exposing database credentials to Discord.

## Future bridge
- Publish article -> bot announces it in Discord.
- New discussion -> optional Discord announcement.
- Admin/mod action -> staff-channel notification.
- WTSL match feed -> bot/API creates or links a discussion.
- Discord roles -> mapped forum roles where desired.

The Vercel app can also use the server-side Discord bot token to announce newly published discussions/articles directly to Discord channels. The standalone gateway bot remains responsible for slash commands and future event-driven features.

## V5 — Stats, dashboard and virtual betting
The forum now incorporates the useful non-financial community functionality from the supplied WTSL Discord bot source: virtual WTSL Dollars, fixture odds, singles/parlays, player-stat summaries, match-stat records, leaderboards, dashboard KPIs, character-profile storage and player-insight storage. These are deliberately implemented as web/database features rather than importing the old monolithic Python bot into Vercel.

The supplied Python modules remain the reference implementation for calculations and ingestion semantics. Production sync workers should feed `wtsl_players`, `betting_fixtures`, `match_stats`, `player_stats_summary` and related tables. Real-money wagering is not supported; betting uses only community virtual currency.

## Existing Replit bot boundary

The supplied production WTSL bot is **not modified** by the community project. Its database remains authoritative for WTSL Dollars, bets, settlements and canonical bot-derived statistics. The community app uses `lib/wtsl-core.ts` as an adapter to a small authenticated HTTPS API exposed by the existing bot/service.

The community Discord bot is independent and can call the same bridge. This keeps failures and deployments isolated.

### Source mapping from supplied bot

The existing source was inspected as the reference implementation for:

- `wtsl_betting.py` — odds/betting semantics
- `matchlog_stats.py` and `matchlog_store.py` — MatchLog ingestion, reconciliation and player summaries
- `match_preview.py` — previews and matchup context
- `wtsl_results.py` — result handling
- `player_insights.py` — insights/training focus
- `overall_ratings.py` — rating calculations
- `character_stats.py` — character/profile metrics
- `tennis_stats_scraper.py` and `screenshot_stats_store.py` — stat acquisition/storage

These modules are **not copied into Vercel as a second authoritative system**. Their outputs/semantics are exposed through the existing bot/API and displayed by the community site.
