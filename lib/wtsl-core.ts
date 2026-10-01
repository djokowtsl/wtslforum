/**
 * Server-side adapter for the existing WTSL Replit bot/Core API.
 *
 * The Forum never receives Replit database credentials. The existing bot
 * remains authoritative for betting balances, fixtures, settlements and
 * canonical WTSL data.
 *
 * Current Core API is read-only. Betting writes remain disabled here until
 * an explicit write endpoint is added to the Replit API.
 */
const base = (process.env.WTSL_CORE_API_URL || '').replace(/\/$/, '');
const token = process.env.WTSL_CORE_API_KEY || '';

async function core<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!base) throw new Error('WTSL core API is not configured');
  if (!token) throw new Error('WTSL core API key is not configured');

  const headers = new Headers(init.headers);
  headers.set('accept', 'application/json');
  headers.set('authorization', `Bearer ${token}`);

  const res = await fetch(`${base}${path}`, {
    ...init,
    headers,
    cache: 'no-store',
  });

  if (!res.ok) {
    throw new Error(`WTSL core API ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export type CoreFixture = {
  key: string;
  season?: string | number;
  tour?: string;
  tournament?: string;
  tournament_id?: string | number | null;
  first_id?: string | number;
  first_name?: string;
  first_avatar?: string | null;
  second_id?: string | number;
  second_name?: string;
  second_avatar?: string | null;
  odds_one?: number | string;
  odds_two?: number | string;
  scheduled_at?: string | null;
  round_deadline?: string | null;
  status: string;
  pool_total?: number | string;
  pool_one?: number | string;
  pool_two?: number | string;
  // Only present on settled fixtures (status 'settled', from recent_settled).
  winner_id?: string | number | null;
  result_note?: string | null;
  settled_at?: string | null;
  total_bets?: number;
  first_bets?: number;
  second_bets?: number;
};

export type CorePredictionRow = {
  challonge_user_id: string;
  challonge_username: string | null;
  prediction_name: string | null;
  discord_user_id: number | null;
  tournaments: number;
  tournaments_won: number;
  total_score: number;
  total_score_potential: number;
  total_picks: number;
  total_picks_potential: number;
  total_losers_bracket_points: number;
  average_score: number;
};

export type CoreMatchlogLeaderboardRow = {
  player: string;
  tour: string;
  source: string;
  matches: number;
  ratings: Record<string, number>;
  metrics: Record<string, number>;
};

export const wtslCore = {
  configured: () => Boolean(base && token),

  health: () =>
    core<{ ok: boolean; mode: string }>('/api/core/health'),

  capabilities: () =>
    core<{
      read_only: boolean;
      sources: Record<string, unknown>;
      write_operations: boolean;
    }>('/api/core/capabilities'),

  fixtures: async () => {
    const result = await core<{
      open: CoreFixture[];
      recent_settled: CoreFixture[];
    }>('/api/core/betting/fixtures');
    return result.open;
  },

  /** Both the open board and the bot's recently-settled fixtures in one call. */
  fixturesBoard: async () =>
    core<{
      open: CoreFixture[];
      recent_settled: CoreFixture[];
    }>('/api/core/betting/fixtures'),

  fixture: (fixtureKey: string | number) =>
    core<CoreFixture>(
      `/api/core/betting/fixtures/${encodeURIComponent(String(fixtureKey))}`,
    ),

  balance: (discordId: string) =>
    core<{
      discord_user_id: string | number;
      balance: number | string;
      total_staked?: number | string;
      total_returned?: number | string;
      total_profit?: number | string;
    }>(
      `/api/core/betting/account/${encodeURIComponent(discordId)}`,
    ),

  bets: (discordId: string) =>
    core<unknown[]>(
      `/api/core/betting/account/${encodeURIComponent(discordId)}/bets`,
    ),

  leaderboard: () =>
    core<unknown[]>('/api/core/betting/leaderboard'),

  predictionsLeaderboard: (limit = 100) =>
    core<CorePredictionRow[]>(
      `/api/core/predictions/leaderboard?limit=${encodeURIComponent(String(limit))}`,
    ),

  matchlogLeaderboard: (tour: 'atp' | 'wta', minMatches = 20) =>
    core<{
      tour: string;
      min_matches: number;
      rows: CoreMatchlogLeaderboardRow[];
    }>(
      `/api/core/matchlog/leaderboard?tour=${encodeURIComponent(tour)}&min_matches=${encodeURIComponent(String(minMatches))}`,
    ),

  results: () => core<unknown[]>('/api/core/results'),

  matchSchedules: () => core<unknown[]>('/api/core/match-schedules'),

  // Intentionally unavailable until the Replit API exposes an authenticated
  // write endpoint. This prevents the Forum from creating a second ledger.
  placeBet: async (_payload: {
    discordId: string;
    fixtureId: string | number;
    selectionId: string | number;
    stake: number;
  }) => {
    throw new Error(
      'Bet placement is currently read-only. The WTSL Core API does not expose a betting write endpoint yet.',
    );
  },
};
