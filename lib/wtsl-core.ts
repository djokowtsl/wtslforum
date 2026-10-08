/**
 * Server-side adapter for the existing WTSL Replit bot/Core API.
 *
 * The Forum never receives Replit database credentials. The existing bot
 * remains authoritative for its domain data. Forum claim approvals use the
 * narrowly scoped matchlog identity-sync endpoint; betting writes remain
 * disabled here.
 */
const base = (process.env.WTSL_CORE_API_URL || '').replace(/\/$/, '');
const token = process.env.WTSL_CORE_API_KEY || '';
// The complete results payload and exact-event verification take longer than
// a small health request. Do not turn normal source latency into empty boards.
export const WTSL_CORE_PUBLIC_TIMEOUT_MS = 20_000;
export const WTSL_CORE_FIXTURES_TIMEOUT_MS = 120_000;
const WTSL_CORE_ACCOUNT_TIMEOUT_MS = 5_000;

type CoreRequestOptions = {
  timeoutMs?: number;
  logLabel?: string;
};

async function core<T>(
  path: string,
  init: RequestInit = {},
  options: CoreRequestOptions = {},
): Promise<T> {
  if (!base) throw new Error('WTSL core API is not configured');
  if (!token) throw new Error('WTSL core API key is not configured');

  const headers = new Headers(init.headers);
  headers.set('accept', 'application/json');
  headers.set('authorization', `Bearer ${token}`);

  const startedAt = Date.now();
  let status: number | null = null;
  const inferredOptions: CoreRequestOptions =
    path === '/api/core/results' || path === '/api/core/betting/fixtures'
      ? {
          timeoutMs: path.endsWith('/results')
            ? WTSL_CORE_PUBLIC_TIMEOUT_MS
            : WTSL_CORE_FIXTURES_TIMEOUT_MS,
          logLabel: path.endsWith('/results') ? 'results' : 'fixtures',
        }
      : {};
  const requestOptions = { ...inferredOptions, ...options };

  try {
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers,
      cache: 'no-store',
      ...(requestOptions.timeoutMs
        ? { signal: init.signal ?? AbortSignal.timeout(requestOptions.timeoutMs) }
        : {}),
    });
    status = res.status;

    if (!res.ok) {
      throw new Error(`WTSL core API ${res.status}`);
    }

    const data = (await res.json()) as T;
    const elapsedMs = Date.now() - startedAt;
    if (requestOptions.logLabel && elapsedMs >= 1_000) {
      console.warn('[wtsl-core] Slow public data request', {
        feed: requestOptions.logLabel,
        elapsedMs,
        status,
      });
    }
    return data;
  } catch (error) {
    if (requestOptions.logLabel) {
      console.warn('[wtsl-core] Public data request failed', {
        feed: requestOptions.logLabel,
        elapsedMs: Date.now() - startedAt,
        status,
        errorType: error instanceof Error ? error.name : 'UnknownError',
      });
    }
    throw error;
  }
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
  first_flag?: string | null;
  first_country?: string | null;
  second_id?: string | number;
  second_name?: string;
  second_avatar?: string | null;
  second_flag?: string | null;
  second_country?: string | null;
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

export type CoreMatchlogIdentity = {
  discord_user_id: string | number;
  tour: string;
  player_name: string;
  wtsl_player_id: string | null;
};

export type CoreMatchlogIdentitySyncInput = {
  discord_user_id: string;
  tour: 'atp' | 'wta';
  player_name: string;
  wtsl_player_id: string;
};

export type CoreMatchlogIdentitySyncResult = {
  status: 'synced' | 'already_synced' | 'conflict';
  reason?: string;
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
    }>(
      '/api/core/betting/fixtures', { method: 'POST' });
    return result.open;
  },

  /** Both the open board and the bot's recently-settled fixtures in one call. */
  fixturesBoard: async () =>
    core<{
      open: CoreFixture[];
      recent_settled: CoreFixture[];
    }>(
      '/api/core/betting/fixtures', { method: 'POST' }),

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
      {},
      { timeoutMs: WTSL_CORE_ACCOUNT_TIMEOUT_MS, logLabel: 'account-balance' },
    ),

  bets: (discordId: string) =>
    core<unknown[]>(
      `/api/core/betting/account/${encodeURIComponent(discordId)}/bets`,
      {},
      { timeoutMs: WTSL_CORE_ACCOUNT_TIMEOUT_MS, logLabel: 'account-bets' },
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

  matchlogIdentities: (discordId: string) =>
    core<{ identities: CoreMatchlogIdentity[] }>(
      `/api/core/matchlog/identities?discord_user_id=${encodeURIComponent(discordId)}`,
      { signal: AbortSignal.timeout(5000) },
    ),

  /** The bot accepts only identity links approved on the Forum or WTSL server. */
  syncMatchlogIdentity: async (identity: CoreMatchlogIdentitySyncInput) => {
    const response = await core<{ ok: boolean; results: CoreMatchlogIdentitySyncResult[] }>(
      '/api/core/matchlog/identities/sync',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ identities: [identity] }),
        signal: AbortSignal.timeout(5000),
      },
    );
    const result = response.results?.[0];
    if (!result) throw new Error('WTSL Core API returned no identity sync result.');
    if (!response.ok || result.status === 'conflict') {
      throw new Error(result.reason || 'WTSL Core API rejected the approved identity.');
    }
    return result;
  },

  results: () =>
    core<unknown[]>(
      '/api/core/results',
      {},
      { timeoutMs: WTSL_CORE_PUBLIC_TIMEOUT_MS, logLabel: 'results' },
    ),

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
