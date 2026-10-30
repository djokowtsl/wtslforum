import type { CoreFixture, CoreMatchlogLeaderboardRow } from './wtsl-core';
import { normalizePlayerName } from './queries';

export type VerifiedMatchIdentity = {
  wtsl_player_id: string | number;
  tour: string;
  player_name: string;
};

export type MatchKeyInsight = {
  category: string;
  metric: string;
  playerValue: number;
  opponentValue: number | null;
  playerHasEdge: boolean;
  advice: string;
};

export type DashboardMatchKeys = {
  fixture: CoreFixture;
  playerName: string;
  opponentName: string;
  playerMatches: number | null;
  opponentMatches: number | null;
  keys: MatchKeyInsight[];
  noPlayerStats: boolean;
};

const MATCH_KEY_CATEGORIES: {
  label: string;
  metrics: string[];
  lowerIsBetter?: string[];
}[] = [
  {
    label: 'Serve',
    metrics: ['1st Serve %', '1st Serve Won %', '2nd Serve Won %', 'Aces', 'Double Faults'],
    lowerIsBetter: ['Double Faults'],
  },
  {
    label: 'Return',
    metrics: ['Return Points Won %', 'Return Winners', 'Break Points Won %', 'Breaks / Games %'],
  },
  {
    label: 'Rally Attack',
    metrics: ['Winners', 'Forced Errors', 'Short Rallies Won (<5) %'],
  },
  {
    label: 'Rally Defense',
    metrics: ['Unforced Errors', 'Medium Rallies Won (5-8) %', 'Long Rallies Won (>8) %'],
    lowerIsBetter: ['Unforced Errors'],
  },
  { label: 'Net play', metrics: ['Net Points Won %'] },
];

const TACTICAL_ADVICE: Record<string, { edge: string; deficit: string }> = {
  Serve: {
    edge: 'Build around serve-plus-one and attack the first short reply.',
    deficit: 'Use high-margin targets and protect the second serve before pressing.',
  },
  Return: {
    edge: 'Start with depth and build pressure before changing direction.',
    deficit: 'Protect return depth and avoid chasing early winners.',
  },
  'Rally Attack': {
    edge: 'Take the first clear opening from a strong court position.',
    deficit: 'Create the opening with better court position before accelerating.',
  },
  'Rally Defense': {
    edge: 'Extend exchanges and make the opponent create the risky shot.',
    deficit: 'Use larger targets and depth until the court opens.',
  },
  'Net play': {
    edge: 'Move forward behind a strong approach and commit to the first volley.',
    deficit: 'Choose approach balls carefully and make the first volley count.',
  },
};

function normalizedTour(value: unknown) {
  const tour = String(value ?? '').trim().toLowerCase();
  if (tour === 'atp') return 'te4';
  if (tour === 'wta') return 'te4_(f)';
  return tour;
}

function numericId(value: unknown) {
  const id = String(value ?? '').trim();
  if (!/^\d+$/.test(id)) return '';
  const normalized = id.replace(/^0+(?=\d)/, '');
  return normalized === '0' ? '' : normalized;
}

function scheduleTime(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

/**
 * Selects only an official open fixture containing the approved WTSL player ID.
 * Multiple matches are safe to resolve only when each has a usable schedule time.
 */
export function findVerifiedUpcomingFixture(
  fixtures: CoreFixture[],
  identity: VerifiedMatchIdentity,
): CoreFixture | null {
  const playerId = numericId(identity.wtsl_player_id);
  const tour = normalizedTour(identity.tour);
  if (!playerId || !['te4', 'te4_(f)'].includes(tour)) return null;

  const matches = fixtures.filter((fixture) => {
    if (normalizedTour(fixture.tour) !== tour) return false;
    return numericId(fixture.first_id) === playerId
      || numericId(fixture.second_id) === playerId;
  });
  if (matches.length === 1) return matches[0];
  if (matches.length === 0) return null;

  const dated = matches
    .map((fixture) => ({ fixture, timestamp: scheduleTime(fixture.scheduled_at) }))
    .filter((item): item is { fixture: CoreFixture; timestamp: number } => item.timestamp !== null);
  if (dated.length !== matches.length) return null;
  dated.sort((a, b) => a.timestamp - b.timestamp);
  return dated[0]?.fixture ?? null;
}

function formatMetric(metric: string, value: number) {
  if (metric.includes('%')) return `${(value * 100).toFixed(1)}%`;
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function adviceFor(category: string, playerHasEdge: boolean) {
  const advice = TACTICAL_ADVICE[category];
  return playerHasEdge ? advice.edge : advice.deficit;
}

/**
 * Builds up to four matchup keys from the same MatchLog aggregates used by
 * `/matchkeys`. Only the signed-in player's row and their listed opponent are
 * returned to the dashboard.
 */
export function buildDashboardMatchKeys(
  fixture: CoreFixture,
  playerId: string | number,
  rows: CoreMatchlogLeaderboardRow[],
): DashboardMatchKeys {
  const wantedId = numericId(playerId);
  const playerIsFirst = numericId(fixture.first_id) === wantedId;
  const playerName = String((playerIsFirst ? fixture.first_name : fixture.second_name) ?? '');
  const opponentName = String((playerIsFirst ? fixture.second_name : fixture.first_name) ?? '');
  const tour = normalizedTour(fixture.tour) === 'te4_(f)' ? 'wta' : 'atp';
  const findRow = (name: string) => rows.find((row) =>
    row.tour.toLowerCase() === tour
    && row.source === 'matchlog'
    && normalizePlayerName(row.player) === normalizePlayerName(name),
  ) ?? null;
  const player = findRow(playerName);
  const opponent = findRow(opponentName);

  if (!player) {
    return {
      fixture,
      playerName,
      opponentName,
      playerMatches: null,
      opponentMatches: opponent?.matches ?? null,
      keys: [],
      noPlayerStats: true,
    };
  }

  const keys: MatchKeyInsight[] = [];
  if (opponent) {
    for (const category of MATCH_KEY_CATEGORIES) {
      const comparisons = category.metrics.flatMap((metric) => {
        const playerValue = player.metrics[metric];
        const opponentValue = opponent.metrics[metric];
        if (typeof playerValue !== 'number' || !Number.isFinite(playerValue)
          || typeof opponentValue !== 'number' || !Number.isFinite(opponentValue)
          || playerValue === opponentValue) return [];
        const lowerIsBetter = category.lowerIsBetter?.includes(metric) ?? false;
        const playerHasEdge = lowerIsBetter
          ? playerValue < opponentValue
          : playerValue > opponentValue;
        return [{ metric, playerValue, opponentValue, playerHasEdge }];
      });
      const playerEdges = comparisons.filter((item) => item.playerHasEdge);
      const opponentEdges = comparisons.filter((item) => !item.playerHasEdge);
      if (playerEdges.length === opponentEdges.length || comparisons.length === 0) continue;

      const playerHasEdge = playerEdges.length > opponentEdges.length;
      const candidates = playerHasEdge ? playerEdges : opponentEdges;
      candidates.sort((a, b) => playerHasEdge
        ? Math.abs(b.playerValue - b.opponentValue) - Math.abs(a.playerValue - a.opponentValue)
        : Math.abs(a.playerValue - a.opponentValue) - Math.abs(b.playerValue - b.opponentValue));
      const selected = candidates[0];
      if (!selected) continue;
      keys.push({
        category: category.label,
        metric: selected.metric,
        playerValue: selected.playerValue,
        opponentValue: selected.opponentValue,
        playerHasEdge,
        advice: adviceFor(category.label, playerHasEdge),
      });
    }
  }

  if (keys.length === 0) {
    const ratings = Object.entries(player.ratings)
      .filter(([, value]) => Number.isFinite(value))
      .sort((a, b) => b[1] - a[1]);
    const strongestEntry = ratings[0];
    const strongest = strongestEntry?.[0]
      .replace(/\s*\(Overall\)$/i, '')
      .replace(/\s+Rating$/i, '');
    if (strongest && strongestEntry) {
      keys.push({
        category: 'Player profile',
        metric: strongest,
        playerValue: strongestEntry[1],
        opponentValue: null,
        playerHasEdge: true,
        advice: `Build around your strongest available MatchLog rating: ${strongest.toLowerCase()}.`,
      });
    }
  }

  return {
    fixture,
    playerName,
    opponentName,
    playerMatches: player.matches,
    opponentMatches: opponent?.matches ?? null,
    keys: keys.slice(0, 4),
    noPlayerStats: false,
  };
}

export function formatMatchKeyMetric(metric: string, value: number) {
  return formatMetric(metric, value);
}
