/**
 * Adapter for the existing WTSL Replit bot/API.
 *
 * The community site never receives the Replit database credentials. The
 * existing bot remains authoritative for betting, balances, settlements and
 * canonical WTSL statistics. Keep GET endpoints read-only; write endpoints
 * are explicit and authenticated.
 */
const base = (process.env.WTSL_CORE_API_URL || '').replace(/\/$/, '');
const token = process.env.WTSL_CORE_API_TOKEN || '';

async function core<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!base) throw new Error('WTSL core API is not configured');
  const headers = new Headers(init.headers);
  headers.set('accept', 'application/json');
  headers.set('authorization', `Bearer ${token}`);
  const res = await fetch(`${base}${path}`, { ...init, headers, cache: 'no-store' });
  if (!res.ok) throw new Error(`WTSL core API ${res.status}`);
  return res.json() as Promise<T>;
}

export type CorePlayer = { id: string|number; name: string; avatarUrl?: string; flagUrl?: string; country?: string; rank?: number; tourElo?: number };
export type CoreFixture = { id: string|number; tournamentKey?: string; playerOne: CorePlayer; playerTwo: CorePlayer; oddsOne?: number; oddsTwo?: number; scheduledAt?: string; status: string };

export const wtslCore = {
  configured: () => Boolean(base && token),
  player: (id: string|number) => core<CorePlayer>(`/players/${encodeURIComponent(id)}`),
  players: () => core<CorePlayer[]>('/players'),
  stats: () => core<unknown>('/stats'),
  fixtures: () => core<CoreFixture[]>('/fixtures?status=open'),
  balance: (discordId: string) => core<{discordId:string; balance:number}>(`/accounts/${encodeURIComponent(discordId)}/balance`),
  bets: (discordId: string) => core<unknown[]>(`/accounts/${encodeURIComponent(discordId)}/bets`),
  placeBet: (payload: {discordId:string; fixtureId:string|number; selectionId:string|number; stake:number}) => core('/bets', { method:'POST', body: JSON.stringify(payload), headers:{'content-type':'application/json'} }),
};
