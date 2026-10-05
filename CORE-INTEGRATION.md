# WTSL Core API integration

The existing Replit WTSL bot remains authoritative. The Forum never receives
Replit database credentials and must not maintain a second WTSL Dollar ledger.

## Current API

The updated Replit integration currently exposes authenticated, read-only
routes under `/api/core`:

- `GET /api/core/health`
- `GET /api/core/capabilities`
- `GET /api/core/betting/fixtures`
- `GET /api/core/betting/fixtures/<fixture_key>`
- `GET /api/core/betting/account/<discord_user_id>`
- `GET /api/core/betting/account/<discord_user_id>/bets`
- `GET /api/core/betting/leaderboard`
- `GET /api/core/results`
- `GET /api/core/match-schedules`

All require:

`Authorization: Bearer <WTSL_CORE_API_KEY>`

## Forum environment variables

Set these server-side in Vercel:

```env
WTSL_CORE_API_URL=https://YOUR-REPLIT-APP.replit.app
WTSL_CORE_API_KEY=YOUR_LONG_RANDOM_SECRET
```

Do not prefix the key with `NEXT_PUBLIC_`.

The same `WTSL_CORE_API_KEY` must be configured as a Replit Secret for
the existing bot.

## Current write status

The Replit Core API is read-only for domain data such as betting and fixtures. The Forum uses one narrowly scoped authenticated write endpoint for admin-approved ATP/WTA identity synchronization. The Forum therefore does
not write betting balances, singles or parlays to its own database.

The Forum's betting placement routes currently return HTTP 501 until an
explicit authenticated write endpoint is added to the existing WTSL bot.
This is intentional and prevents two competing WTSL Dollar ledgers.

## Future write endpoint

When ready, add a controlled write endpoint to the Replit API and route
Forum betting requests through it. The Replit bot must remain responsible
for balance validation, fixture validation, odds, stake limits, writes and
settlement.
