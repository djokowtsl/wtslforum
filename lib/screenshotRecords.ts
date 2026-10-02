import { sql } from '@/lib/db';
import { SCREENSHOT_METRIC_FIELDS } from '@/lib/screenshotRecordFields';

export type ScreenshotTour = 'TE4' | 'TE4_(F)';
export type ScreenshotStatusFilter = 'any' | 'unflagged' | 'FOR REVIEW' | 'DAVIS CUP' | 'DUPLICATE';

export type ScreenshotRecordInput = {
  recordId: string;
  sourceRow: number;
  playerName: string;
  opponentName: string;
  tournamentName: string;
  date: string;
  playedOn: string | null;
  score: string;
  reviewStatus: string;
  data: Record<string, string | number>;
};

export type ScreenshotRecordFilters = {
  tour: ScreenshotTour;
  page: number;
  player: string;
  opponent: string;
  tournament: string;
  search: string;
  year: number | null;
  status: ScreenshotStatusFilter;
  metric: (typeof SCREENSHOT_METRIC_FIELDS)[number] | '';
  min: number | null;
  max: number | null;
};

let tablesReady = false;

async function ensureScreenshotRecordTables() {
  if (tablesReady) return;
  await sql`
    CREATE TABLE IF NOT EXISTS screenshot_record_sync_state (
      tour TEXT PRIMARY KEY,
      active_sync_id TEXT NOT NULL,
      record_count INTEGER NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS screenshot_match_records (
      tour TEXT NOT NULL,
      sync_id TEXT NOT NULL,
      record_id TEXT NOT NULL,
      source_row INTEGER NOT NULL,
      player_name TEXT NOT NULL,
      opponent_name TEXT NOT NULL,
      tournament_name TEXT NOT NULL DEFAULT '',
      date_label TEXT NOT NULL DEFAULT '',
      played_on DATE,
      score TEXT NOT NULL,
      review_status TEXT NOT NULL DEFAULT '',
      record_data JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (tour, sync_id, record_id)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS screenshot_records_player_idx ON screenshot_match_records(tour, sync_id, LOWER(player_name))`;
  await sql`CREATE INDEX IF NOT EXISTS screenshot_records_opponent_idx ON screenshot_match_records(tour, sync_id, LOWER(opponent_name))`;
  await sql`CREATE INDEX IF NOT EXISTS screenshot_records_date_idx ON screenshot_match_records(tour, sync_id, played_on DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS screenshot_records_tournament_idx ON screenshot_match_records(tour, sync_id, tournament_name)`;
  tablesReady = true;
}

export async function upsertScreenshotRecordBatch(
  tour: ScreenshotTour,
  syncId: string,
  rows: ScreenshotRecordInput[],
) {
  await ensureScreenshotRecordTables();
  const payload = rows.map((row) => ({
    record_id: row.recordId,
    source_row: row.sourceRow,
    player_name: row.playerName,
    opponent_name: row.opponentName,
    tournament_name: row.tournamentName,
    date_label: row.date,
    played_on: row.playedOn,
    score: row.score,
    review_status: row.reviewStatus,
    record_data: row.data,
  }));
  await sql`
    INSERT INTO screenshot_match_records (
      tour, sync_id, record_id, source_row, player_name, opponent_name,
      tournament_name, date_label, played_on, score, review_status, record_data
    )
    SELECT
      ${tour}, ${syncId}, record_id, source_row, player_name, opponent_name,
      tournament_name, date_label, played_on, score, review_status, record_data
    FROM jsonb_to_recordset(${JSON.stringify(payload)}::jsonb) AS input(
      record_id TEXT,
      source_row INTEGER,
      player_name TEXT,
      opponent_name TEXT,
      tournament_name TEXT,
      date_label TEXT,
      played_on DATE,
      score TEXT,
      review_status TEXT,
      record_data JSONB
    )
    ON CONFLICT (tour, sync_id, record_id) DO UPDATE SET
      source_row = EXCLUDED.source_row,
      player_name = EXCLUDED.player_name,
      opponent_name = EXCLUDED.opponent_name,
      tournament_name = EXCLUDED.tournament_name,
      date_label = EXCLUDED.date_label,
      played_on = EXCLUDED.played_on,
      score = EXCLUDED.score,
      review_status = EXCLUDED.review_status,
      record_data = EXCLUDED.record_data,
      updated_at = NOW()
  `;
  return rows.length;
}

export async function activateScreenshotRecordSnapshot(
  tour: ScreenshotTour,
  syncId: string,
  expectedRows: number,
) {
  await ensureScreenshotRecordTables();
  const storedRows = await sql`
    SELECT COUNT(*)::int AS stored
    FROM screenshot_match_records
    WHERE tour = ${tour} AND sync_id = ${syncId}
  `;
  const stored = Number(storedRows[0]?.stored ?? 0);
  if (stored !== expectedRows) {
    throw new Error(`Screenshot snapshot is incomplete (${stored}/${expectedRows})`);
  }

  const activated = await sql`
    WITH activated AS (
      INSERT INTO screenshot_record_sync_state (tour, active_sync_id, record_count, updated_at)
      VALUES (${tour}, ${syncId}, ${expectedRows}, NOW())
      ON CONFLICT (tour) DO UPDATE SET
        active_sync_id = EXCLUDED.active_sync_id,
        record_count = EXCLUDED.record_count,
        updated_at = NOW()
      RETURNING tour, active_sync_id
    ),
    removed AS (
      DELETE FROM screenshot_match_records AS old
      USING activated
      WHERE old.tour = activated.tour
        AND old.sync_id <> activated.active_sync_id
      RETURNING old.record_id
    )
    SELECT
      (SELECT COUNT(*)::int FROM screenshot_match_records
        WHERE tour = ${tour} AND sync_id = ${syncId}) AS active_rows,
      (SELECT COUNT(*)::int FROM removed) AS removed_rows
  `;
  return Number(activated[0]?.active_rows ?? 0);
}

export async function getScreenshotRecordPage(filters: ScreenshotRecordFilters) {
  await ensureScreenshotRecordTables();
  const pageSize = 50;
  const offset = (filters.page - 1) * pageSize;
  const counts = await sql`
    SELECT COUNT(*)::int AS total
    FROM screenshot_match_records AS r
    JOIN screenshot_record_sync_state AS active
      ON active.tour = r.tour AND active.active_sync_id = r.sync_id
    WHERE r.tour = ${filters.tour}
      AND (${filters.player} = '' OR LOWER(r.player_name) = LOWER(${filters.player}))
      AND (${filters.opponent} = '' OR LOWER(r.opponent_name) = LOWER(${filters.opponent}))
      AND (${filters.tournament} = '' OR r.tournament_name ILIKE '%' || ${filters.tournament} || '%')
      AND (${filters.search} = '' OR CONCAT_WS(' ', r.player_name, r.opponent_name,
        r.tournament_name, r.score, r.date_label) ILIKE '%' || ${filters.search} || '%')
      AND (${filters.year}::int IS NULL OR (
        r.played_on >= MAKE_DATE(${filters.year}::int, 1, 1)
        AND r.played_on < MAKE_DATE(${filters.year}::int + 1, 1, 1)
      ))
      AND (
        ${filters.status} = 'any'
        OR (${filters.status} = 'unflagged' AND COALESCE(r.review_status, '') = '')
        OR r.review_status = ${filters.status}
      )
      AND (${filters.metric} = '' OR r.record_data ? ${filters.metric})
      AND (${filters.min}::numeric IS NULL OR (r.record_data ->> ${filters.metric})::numeric >= ${filters.min}::numeric)
      AND (${filters.max}::numeric IS NULL OR (r.record_data ->> ${filters.metric})::numeric <= ${filters.max}::numeric)
  `;
  const records = await sql`
    SELECT
      r.record_id, r.source_row, r.player_name, r.opponent_name,
      r.tournament_name, r.date_label, r.score, r.review_status, r.record_data
    FROM screenshot_match_records AS r
    JOIN screenshot_record_sync_state AS active
      ON active.tour = r.tour AND active.active_sync_id = r.sync_id
    WHERE r.tour = ${filters.tour}
      AND (${filters.player} = '' OR LOWER(r.player_name) = LOWER(${filters.player}))
      AND (${filters.opponent} = '' OR LOWER(r.opponent_name) = LOWER(${filters.opponent}))
      AND (${filters.tournament} = '' OR r.tournament_name ILIKE '%' || ${filters.tournament} || '%')
      AND (${filters.search} = '' OR CONCAT_WS(' ', r.player_name, r.opponent_name,
        r.tournament_name, r.score, r.date_label) ILIKE '%' || ${filters.search} || '%')
      AND (${filters.year}::int IS NULL OR (
        r.played_on >= MAKE_DATE(${filters.year}::int, 1, 1)
        AND r.played_on < MAKE_DATE(${filters.year}::int + 1, 1, 1)
      ))
      AND (
        ${filters.status} = 'any'
        OR (${filters.status} = 'unflagged' AND COALESCE(r.review_status, '') = '')
        OR r.review_status = ${filters.status}
      )
      AND (${filters.metric} = '' OR r.record_data ? ${filters.metric})
      AND (${filters.min}::numeric IS NULL OR (r.record_data ->> ${filters.metric})::numeric >= ${filters.min}::numeric)
      AND (${filters.max}::numeric IS NULL OR (r.record_data ->> ${filters.metric})::numeric <= ${filters.max}::numeric)
    ORDER BY r.played_on DESC NULLS LAST, r.source_row DESC, r.record_id ASC
    LIMIT ${pageSize} OFFSET ${offset}
  `;

  return {
    records: records.map((row: any) => ({
      recordId: String(row.record_id),
      sourceRow: Number(row.source_row),
      playerName: String(row.player_name),
      opponentName: String(row.opponent_name),
      tournamentName: String(row.tournament_name ?? ''),
      date: String(row.date_label ?? ''),
      score: String(row.score),
      reviewStatus: String(row.review_status ?? ''),
      data: row.record_data && typeof row.record_data === 'object' ? row.record_data : {},
    })),
    total: Number(counts[0]?.total ?? 0),
    page: filters.page,
    pageSize,
  };
}