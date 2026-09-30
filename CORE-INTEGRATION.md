# Existing WTSL Bot Integration

The existing Replit WTSL bot remains authoritative. Do **not** point the forum at its database and do **not** migrate or duplicate the WTSL Dollar ledger.

## Recommended bridge

Expose a small HTTPS API from the existing Replit bot/service. Initially make all GET routes read-only:

- `GET /players`
- `GET /players/:id`
- `GET /stats`
- `GET /fixtures?status=open`
- `GET /accounts/:discordId/balance`
- `GET /accounts/:discordId/bets`

Only after the read-only integration is tested should you expose the single controlled write endpoint:

- `POST /bets`

Example body:

```json
{"discordId":"123","fixtureId":42,"selectionId":"368","stake":100}
```

The existing bot must validate balance, fixture status, selection, stake limits, odds, settlement rules and database writes. The forum must never perform those operations against the Replit database itself.

## Security

Use a long random `WTSL_CORE_API_TOKEN` and require it as a Bearer token. Keep it server-side in Vercel. Add rate limiting and audit logging to the Replit API before enabling `POST /bets`.

## Why this is safer

- Existing bot/database remains unchanged.
- The forum cannot corrupt balances by accident.
- The forum can be redeployed independently.
- Discord bot failures do not affect the existing WTSL bot.
- Betting settlement remains in one authoritative system.

## Data mapping

The forum's WTSL player objects should use the canonical WTSL player ID and display avatar, country/flag, ranking and Tour Elo returned by the existing system. Discord ID remains the community identity and is only linked to a WTSL player when explicitly verified.
