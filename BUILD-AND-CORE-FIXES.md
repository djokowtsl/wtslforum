# WTSL Forum V7 build/API alignment

This build was aligned against the updated `wtsl_core_api.py` from the current
WTSL bot source archive.

Changes:
- Excluded the separate `bot/` Discord bot from the Next.js TypeScript build.
- Standardized the Forum secret name to `WTSL_CORE_API_KEY`.
- Updated the Forum Core API adapter to the actual `/api/core/...` routes.
- Kept betting writes disabled because the current Core API is read-only.
- Removed the local Forum parlay ledger path from the deployment build.
- Fixed the Neon SQL ordering/type issue in `lib/stats.ts`.
- Fixed the possibly-undefined champion URL in `lib/wtsl.ts`.
- Updated the betting/dashboard display to the actual fixture field names
  returned by the Replit API.

Vercel environment variables:
- `WTSL_CORE_API_URL`
- `WTSL_CORE_API_KEY`

Do not expose the API key with `NEXT_PUBLIC_`.

The Replit bot remains the authoritative source for WTSL betting data.
