import { sql } from '@/lib/db';
import { parseTe4CoachShareUrl } from '@/lib/te4CoachEmbed';

const PUBLIC_DMO_PATH = /^dmo\/[^/][^\\]*\.dmo$/i;
const MAX_DATABASE_ID = '9223372036854775807';

export type PublicDmoReplay = {
  id: string;
  tournament: string;
  roundName: string;
  player1: string;
  player2: string;
  submissionDate: string;
  source: 'discord' | 'forum';
  coachShareUrl?: string;
};

export type StoredDmoReplay = PublicDmoReplay & {
  privateBlobPathname: string;
  fileName: string;
};

export function isPublicDmoPath(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= 240
    && PUBLIC_DMO_PATH.test(value)
    && !value.split('/').some((segment) => segment === '.' || segment === '..');
}

function toPublicReplay(row: Record<string, unknown>): PublicDmoReplay {
  const coachShare = parseTe4CoachShareUrl(row.coach_share_url);
  return {
    id: String(row.id),
    tournament: String(row.tournament ?? ''),
    roundName: String(row.round_name ?? ''),
    player1: String(row.player1 ?? ''),
    player2: String(row.player2 ?? ''),
    submissionDate: String(row.submission_date ?? ''),
    source: row.source === 'discord' ? 'discord' : 'forum',
    ...(coachShare.valid && coachShare.url ? { coachShareUrl: coachShare.url } : {}),
  };
}

export function isDmoReplayId(value: string): boolean {
  if (!/^\d{1,19}$/.test(value)) return false;
  const normalized = value.replace(/^0+/, '');
  return normalized.length > 0
    && (
      normalized.length < MAX_DATABASE_ID.length
      || (
        normalized.length === MAX_DATABASE_ID.length
        && normalized <= MAX_DATABASE_ID
      )
    );
}

export async function listPublicDmoReplays(input: {
  cursor?: string | null;
  query?: string;
  limit?: number;
} = {}) {
  const limit = Math.max(1, Math.min(50, Math.floor(input.limit ?? 24)));
  const query = input.query?.trim().slice(0, 100) ?? '';
  const pattern = query ? `%${query.replace(/[\\%_]/g, '\\$&')}%` : null;
  const rows = await sql`
    SELECT id::text AS id,tournament,round_name,player1,player2,
      submission_date::text AS submission_date,source,
      CASE WHEN coach_group_share_consent IS TRUE THEN coach_share_url ELSE NULL END AS coach_share_url
    FROM dmo_submissions
    WHERE (
        public_share_consent IS TRUE
        OR EXISTS (
          SELECT 1
          FROM dmo_replay_publication_overrides AS publication_override
          WHERE publication_override.submission_id=dmo_submissions.id
            AND publication_override.revoked_at IS NULL
        )
      )
      AND private_blob_pathname LIKE 'dmo/%'
      AND LOWER(COALESCE(file_name, private_blob_pathname)) LIKE '%.dmo'
      AND (${input.cursor ?? null}::bigint IS NULL OR id < ${input.cursor ?? null}::bigint)
      AND (
        ${pattern}::text IS NULL
        OR CONCAT_WS(' ',tournament,round_name,player1,player2) ILIKE ${pattern} ESCAPE E'\\\\'
      )
    ORDER BY id DESC
    LIMIT ${limit + 1}
  ` as Array<Record<string, unknown>>;

  const hasMore = rows.length > limit;
  const pageRows = rows.slice(0, limit);
  return {
    matches: pageRows.map(toPublicReplay),
    nextCursor: hasMore ? String(pageRows[pageRows.length - 1].id) : null,
  };
}

export async function getPublicDmoReplay(id: string): Promise<StoredDmoReplay | null> {
  const rows = await sql`
    SELECT id::text AS id,tournament,round_name,player1,player2,
      submission_date::text AS submission_date,source,
      CASE WHEN coach_group_share_consent IS TRUE THEN coach_share_url ELSE NULL END AS coach_share_url,
      private_blob_pathname,file_name
    FROM dmo_submissions
    WHERE id=${id}::bigint
      AND (
        public_share_consent IS TRUE
        OR EXISTS (
          SELECT 1
          FROM dmo_replay_publication_overrides AS publication_override
          WHERE publication_override.submission_id=dmo_submissions.id
            AND publication_override.revoked_at IS NULL
        )
      )
      AND private_blob_pathname LIKE 'dmo/%'
      AND LOWER(COALESCE(file_name, private_blob_pathname)) LIKE '%.dmo'
    LIMIT 1
  ` as Array<Record<string, unknown>>;
  const row = rows[0];
  if (!row || !isPublicDmoPath(row.private_blob_pathname)) return null;

  return {
    ...toPublicReplay(row),
    privateBlobPathname: row.private_blob_pathname,
    fileName: String(row.file_name || `match-${id}.dmo`).slice(0, 120),
  };
}

export async function getPublicDmoCoachReplay(id: string): Promise<PublicDmoReplay | null> {
  if (!isDmoReplayId(id)) return null;
  const rows = await sql`
    SELECT id::text AS id,tournament,round_name,player1,player2,
      submission_date::text AS submission_date,source,coach_share_url
    FROM dmo_submissions
    WHERE id=${id}::bigint
      AND coach_group_share_consent IS TRUE
      AND (
        public_share_consent IS TRUE
        OR EXISTS (
          SELECT 1
          FROM dmo_replay_publication_overrides AS publication_override
          WHERE publication_override.submission_id=dmo_submissions.id
            AND publication_override.revoked_at IS NULL
        )
      )
      AND private_blob_pathname LIKE 'dmo/%'
      AND LOWER(COALESCE(file_name, private_blob_pathname)) LIKE '%.dmo'
      AND coach_share_url IS NOT NULL
    LIMIT 1
  ` as Array<Record<string, unknown>>;
  const row = rows[0];
  if (!row) return null;
  const replay = toPublicReplay(row);
  return replay.coachShareUrl ? replay : null;
}

export function publicDmoReplayMetadata(replay: StoredDmoReplay): PublicDmoReplay {
  const { id, tournament, roundName, player1, player2, submissionDate, source, coachShareUrl } = replay;
  return {
    id,
    tournament,
    roundName,
    player1,
    player2,
    submissionDate,
    source,
    ...(coachShareUrl ? { coachShareUrl } : {}),
  };
}
