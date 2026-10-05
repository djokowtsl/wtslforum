import { sql } from './db';
import { normalizePlayerName } from './queries';
import { computeOfficialHeadToHeadRecord } from './clutchStats';
import {
  adjustOfficialH2HPercent,
  h2hRecordWinPercent,
  parseLiveWtslMatches,
  readOfficialH2HPercent,
  type ParsedLiveMatch,
} from './liveScoreModel';
import { fetchWTSLAllResults, type WTSLAllResultRow } from './wtsl';

const SERVER_LIST_URL = 'https://www.managames.com/tennis/online/TE4_ServerList.php?Poll=1';
const H2H_PAGE_URL = 'https://www.playwtsl.com/TE4/pages/h2h.php';
const H2H_CACHE_MS = 45_000;
const ALL_RESULTS_TIMEOUT_MS = 12_000;
type ProbabilitySource = 'official' | 'all-results' | 'no-history';
type H2HProbability = { percent: number | null; source: ProbabilitySource | null };
const h2hCache = new Map<string, { at: number; result: H2HProbability }>();
let allResultsCache: { at: number; rows: WTSLAllResultRow[] } | null = null;
let allResultsRequest: Promise<WTSLAllResultRow[]> | null = null;

type PlayerRow = {
  wtsl_player_id: string | number;
  tour: string;
  name: string;
  avatar_url: string | null;
  flag_url: string | null;
  country: string | null;
};

function findPlayers(match: ParsedLiveMatch, playersByTour: Map<string, Map<string, PlayerRow>>) {
  const pair = match.name.split(/\s+vs\s+/i);
  if (pair.length !== 2) return null;
  const names = pair.map(normalizePlayerName);
  if (names.some((name) => !name)) return null;
  const tours = match.tourHint
    ? [match.tourHint]
    : ['TE4', 'TE4_(F)'];
  const candidates = tours.flatMap((tour) => {
    const players = playersByTour.get(tour);
    const first = players?.get(names[0]);
    const second = players?.get(names[1]);
    return first && second && String(first.wtsl_player_id) !== String(second.wtsl_player_id)
      ? [{ tour, first, second }]
      : [];
  });
  return candidates.length === 1 ? candidates[0] : null;
}

async function getAllResults() {
  if (allResultsCache && Date.now() - allResultsCache.at < H2H_CACHE_MS) {
    return allResultsCache.rows;
  }
  if (allResultsRequest) return allResultsRequest;

  const request = fetchWTSLAllResults(ALL_RESULTS_TIMEOUT_MS).then((rows) => {
    allResultsCache = { at: Date.now(), rows };
    return rows;
  });
  allResultsRequest = request;
  try {
    return await request;
  } finally {
    if (allResultsRequest === request) allResultsRequest = null;
  }
}

async function h2hBasePercent(
  tour: string,
  mode: string,
  firstId: string | number,
  secondId: string | number,
): Promise<H2HProbability> {
  const cacheKey = `${tour}:${mode}:${firstId}:${secondId}`;
  const cached = h2hCache.get(cacheKey);
  if (cached && Date.now() - cached.at < H2H_CACHE_MS) return cached.result;

  const url = new URL(H2H_PAGE_URL);
  url.searchParams.set('tour', tour);
  url.searchParams.set('pl_one', String(firstId));
  url.searchParams.set('pl_two', String(secondId));
  let officialResponseSucceeded = false;
  try {
    const response = await fetch(url, {
      headers: { 'user-agent': 'WTSL Forum live scoreboard' },
      cache: 'no-store',
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`Official H2H page returned ${response.status}`);
    officialResponseSucceeded = true;
    const percent = readOfficialH2HPercent(await response.text());
    if (percent !== null) {
      const result = { percent, source: 'official' as const };
      h2hCache.set(cacheKey, { at: Date.now(), result });
      return result;
    }
  } catch (error) {
    console.warn('[live-scores] official H2H lookup failed', error instanceof Error ? error.message : 'Unknown error');
  }

  if (tour === 'TE4' && mode === 'Singles') {
    try {
      const rows = await getAllResults();
      const record = computeOfficialHeadToHeadRecord(rows, firstId, secondId);
      const result: H2HProbability = {
        percent: h2hRecordWinPercent(record),
        source: record.matches > 0 ? 'all-results' : 'no-history',
      };
      h2hCache.set(cacheKey, { at: Date.now(), result });
      return result;
    } catch (error) {
      console.warn('[live-scores] all-results H2H lookup failed', error instanceof Error ? error.message : 'Unknown error');
    }
  }

  // A successful official page with no H2H bar means there is no recorded history.
  // Do not infer that from a failed page request, especially for non-ATP sources.
  const result: H2HProbability = officialResponseSucceeded
    ? { percent: 50, source: 'no-history' }
    : { percent: null, source: null };
  if (officialResponseSucceeded) h2hCache.set(cacheKey, { at: Date.now(), result });
  return result;
}

async function enrichMatch(
  match: ParsedLiveMatch,
  playersByTour: Map<string, Map<string, PlayerRow>>,
) {
  const entry = findPlayers(match, playersByTour);
  if (!entry) {
    return { ...match, tour: match.tourHint, players: null, probability: null, probabilitySource: null };
  }

  let probability: number | null = null;
  let probabilitySource: ProbabilitySource | null = null;
  try {
    const h2h = await h2hBasePercent(
      entry.tour,
      match.mode,
      entry.first.wtsl_player_id,
      entry.second.wtsl_player_id,
    );
    if (h2h.percent !== null) {
      probability = adjustOfficialH2HPercent(h2h.percent, match.bestOf);
      if (probability !== null) probabilitySource = h2h.source;
    }
  } catch (error) {
    console.warn('[live-scores] probability lookup failed', error instanceof Error ? error.message : 'Unknown error');
  }

  return {
    ...match,
    tour: entry.tour,
    players: {
      first: {
        id: entry.first.wtsl_player_id,
        name: entry.first.name,
        avatarUrl: entry.first.avatar_url,
        flagUrl: entry.first.flag_url,
        country: entry.first.country,
      },
      second: {
        id: entry.second.wtsl_player_id,
        name: entry.second.name,
        avatarUrl: entry.second.avatar_url,
        flagUrl: entry.second.flag_url,
        country: entry.second.country,
      },
    },
    probability,
    probabilitySource,
  };
}

export async function getLiveWtslMatches() {
  const response = await fetch(SERVER_LIST_URL, {
    headers: { 'user-agent': 'WTSL Forum live scoreboard' },
    cache: 'no-store',
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`TE4 server list returned ${response.status}`);
  const matches = parseLiveWtslMatches(await response.text()).slice(0, 12);
  if (matches.length === 0) return { matches: [], checkedAt: new Date().toISOString() };

  let rows: PlayerRow[] = [];
  try {
    rows = await sql`
      SELECT wtsl_player_id, tour, name, avatar_url, flag_url, country
      FROM wtsl_players
      WHERE tour IN ('TE4','TE4_(F)')
      ORDER BY synced_at DESC
    ` as PlayerRow[];
  } catch (error) {
    console.warn('[live-scores] player rankings unavailable', error instanceof Error ? error.message : 'Unknown error');
  }

  const playersByTour = new Map<string, Map<string, PlayerRow>>();
  for (const row of rows) {
    const name = normalizePlayerName(row.name);
    if (!name) continue;
    const map = playersByTour.get(row.tour) ?? new Map<string, PlayerRow>();
    if (!map.has(name)) map.set(name, row);
    playersByTour.set(row.tour, map);
  }

  return {
    matches: await Promise.all(matches.map((match) => enrichMatch(match, playersByTour))),
    checkedAt: new Date().toISOString(),
  };
}
