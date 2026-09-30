# WTSL Community Forum V5

A standalone WTSL community/media platform for Vercel, with Discord identity, PostgreSQL persistence, tournament/player integration, virtual WTSL Dollar betting, stats, dashboards and a Discord bridge.

## New in V5
- WTSL stats centre and player leaderboard
- WTSL dashboard
- Virtual WTSL Dollar betting fixtures
- Singles and parlay database/API foundations
- Match-stat and player-summary schemas
- Character-profile and player-insight storage
- Shared WTSL player identity layer: avatar, flag, ranking and Tour Elo
- Tournament-linked community architecture

The supplied `stats-dashboard-source.zip` was used as the reference for betting settlement/odds, MatchLog/stat summaries, player insights, overall ratings, character data, match previews and durable bot state. The old Python bot is not copied wholesale because Vercel should host the web application while the Discord gateway/sync worker runs separately.

See `DEPLOYMENT.md` and `ARCHITECTURE.md`.
