import { sql } from '@/lib/db';
import { normalizePlayerName } from '@/lib/queries';
import { isTourCode } from '@/lib/wtsl';

export type ResultContext = {
  messageId: string;
  createdAt: string;
  date: string;
  tournament: string;
  round: string;
  score: string;
  tour: string | null;
  winners: string[];
  losers: string[];
  content: string;
};

export type MatchRow = {
  id: string;
  source_id: string | null;
  source_message_id: string | null;
  tour: string;
  tournament_name: string | null;
  round_name: string | null;
  player_one_id: string;
  player_two_id: string;
  player_one_name: string | null;
  player_two_name: string | null;
  score: string | null;
  winner_id: string | null;
};

export class MatchResolutionError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function normalizeName(value: string) {
  return normalizePlayerName(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/gi, '');
}

function splitSide(value: string) {
  return value
    .split(/\s*(?:&|\/|\+|,|\band\b)\s*/i)
    .map(normalizeName)
    .filter(Boolean)
    .sort();
}

function sameSide(rowName: string | null, rowId: string, expectedNames: string[]) {
  const raw = rowName || rowId.replace(/^external:/, '');
  const actualParts = splitSide(raw);
  const expectedParts = expectedNames.flatMap(splitSide).sort();
  return actualParts.length === expectedParts.length
    && actualParts.every((part, index) => part === expectedParts[index]);
}

function scorePairs(score: string | null): number[][] {
  if (!score) return [];
  return [...score.matchAll(/(\d{1,2})\s*[-/:]\s*(\d{1,2})(?:\(\d+\))?/g)]
    .map((match) => [Number(match[1]), Number(match[2])]);
}

function scoreMatches(row: MatchRow, expected: string) {
  const actual = scorePairs(row.score);
  const wanted = scorePairs(expected);
  if (!actual.length || actual.length !== wanted.length) return false;
  const winnerIsOne = String(row.winner_id) === String(row.player_one_id);
  if (!winnerIsOne && String(row.winner_id) !== String(row.player_two_id)) return false;
  const oriented = actual.map(([one, two]) => winnerIsOne ? [one, two] : [two, one]);
  return oriented.every(([a, b], index) => a === wanted[index][0] && b === wanted[index][1]);
}

function rowMatchesResult(row: MatchRow, result: ResultContext) {
  const oneWins = String(row.winner_id) === String(row.player_one_id);
  const twoWins = String(row.winner_id) === String(row.player_two_id);
  if (!oneWins && !twoWins) return false;
  const winnerName = oneWins ? row.player_one_name : row.player_two_name;
  const winnerId = oneWins ? row.player_one_id : row.player_two_id;
  const loserName = oneWins ? row.player_two_name : row.player_one_name;
  const loserId = oneWins ? row.player_two_id : row.player_one_id;
  return sameSide(winnerName, winnerId, result.winners)
    && sameSide(loserName, loserId, result.losers)
    && scoreMatches(row, result.score);
}

export async function resolveInterviewMatch(result: ResultContext) {
  const rows = await sql`
    SELECT m.id::text AS id, m.source_id, m.source_message_id, m.tour,
      m.tournament_name, m.round_name, m.player_one_id, m.player_two_id,
      p1.name AS player_one_name, p2.name AS player_two_name,
      m.score, m.winner_id
    FROM match_stats m
    LEFT JOIN wtsl_players p1
      ON p1.wtsl_player_id=m.player_one_id AND p1.tour=m.tour
    LEFT JOIN wtsl_players p2
      ON p2.wtsl_player_id=m.player_two_id AND p2.tour=m.tour
    WHERE (m.played_at AT TIME ZONE 'UTC')::date=${result.date}::date
      AND lower(trim(COALESCE(m.tournament_name,'')))=lower(trim(${result.tournament}))
      AND lower(trim(COALESCE(m.round_name,'')))=lower(trim(${result.round}))
      AND (${result.tour}::text IS NULL OR m.tour=${result.tour})
    LIMIT 500
  ` as MatchRow[];
  const exact = rows.filter((row) => rowMatchesResult(row, result));
  const direct = exact.filter((row) => row.source_message_id === result.messageId);
  const official = exact.filter((row) => String(row.source_id || '').startsWith('recent:'));
  const preferred = direct.length ? direct : official.length ? official : exact;
  if (preferred.length === 1) return preferred[0];
  if (!preferred.length) {
    throw new MatchResolutionError('No official WTSL match exactly matches the result evidence', 404);
  }
  throw new MatchResolutionError('More than one WTSL match exactly matches the result evidence', 409);
}

export function parseInterviewResult(body: any): ResultContext | null {
  const raw = body?.result;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const messageId = String(raw.messageId ?? '');
  const createdAt = String(raw.createdAt ?? '');
  const date = String(raw.date ?? '');
  const tournament = String(raw.tournament ?? '').trim();
  const round = String(raw.round ?? '').trim();
  const score = String(raw.score ?? '').trim();
  const content = String(raw.content ?? '');
  const winners = Array.isArray(raw.winners) ? raw.winners.map((name: unknown) => String(name).trim()) : [];
  const losers = Array.isArray(raw.losers) ? raw.losers.map((name: unknown) => String(name).trim()) : [];
  const tour = raw.tour == null ? null : String(raw.tour);
  const timestamp = Date.parse(createdAt);
  const dateValid = Number.isFinite(timestamp)
    && /^\d{4}-\d{2}-\d{2}$/.test(date)
    && Number.isFinite(Date.parse(`${date}T00:00:00Z`))
    && new Date(timestamp).toISOString().slice(0, 10) === date;
  const scoreValid = scorePairs(score);
  if (
    !/^\d{15,22}$/.test(messageId)
    || !Number.isFinite(timestamp)
    || !dateValid
    || !tournament
    || tournament.length > 160
    || !round
    || round.length > 80
    || !scoreValid.length
    || scoreValid.length > 5
    || !/\b(?:defeated|def\.?|beat)\b/i.test(content)
    || content.length > 2000
    || winners.length < 1
    || winners.length > 2
    || losers.length !== winners.length
    || [...winners, ...losers].some((name) => !name || name.length > 100)
    || (tour !== null && !isTourCode(tour))
  ) return null;
  return { messageId, createdAt, date, tournament, round, score, tour, winners, losers, content };
}

function published(req: NextRequest, topicId: number, matchKey: string, postType: string) {
  const url = new URL(`/discussions/${topicId}`, req.url).toString();
  return NextResponse.json({ status: 'published', url, matchKey, postType });
}

function pending(message: string, reason?: string) {
    return NextResponse.json(
      { status: 'pending', message, ...(reason ? { reason } : {}) },
      { status: 202 },
    );
    }
