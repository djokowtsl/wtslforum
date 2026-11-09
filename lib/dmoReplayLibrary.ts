import { sql } from '@/lib/db';
import { parseTe4CoachShareUrl } from '@/lib/te4CoachEmbed';

const DMO_SUBMISSION_PATH = /^dmo\/[^/][^\\]*\.dmo$/i;
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

export type DmoReplayCatalogEntry = {
  id: string;
  tournament: string;
  roundName: string;
  player1: string;
  player2: string;
  submissionDate: string;
  source: 'discord' | 'forum';
  hasDmoFile: boolean;
  externalUrl?: string;
  coachShareUrl?: string;
};

export type StoredDmoReplay = PublicDmoReplay & {
  privateBlobPathname: string;
  fileName: string;
};

export type DmoSubmissionReplay = DmoReplayCatalogEntry & {
  privateBlobPathname: string | null;
  fileName: string | null;
};

export function isDmoSubmissionPath(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= 240
    && DMO_SUBMISSION_PATH.test(value)
    && !value.split('/').some((segment) => segment === '.' || segment === '..');
}

function safeRecordingUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim() || value.length > 2048) return undefined;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
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

function toDmoReplayCatalogEntry(row: Record<string, unknown>): DmoReplayCatalogEntry {
  const coachShare = row.coach_group_share_consent === true
    ? parseTe4CoachShareUrl(row.coach_share_url)
    : { valid: false, url: null };
  const privateBlobPathname = isDmoSubmissionPath(row.private_blob_pathname)
    && /\.dmo$/i.test(String(row.file_name || row.private_blob_pathname))
    ? row.private_blob_pathname
    : null;
  const externalUrl = safeRecordingUrl(row.external_url);
  return {
    id: String(row.id),
    tournament: String(row.tournament ?? ''),
    roundName: String(row.round_name ?? ''),
    player1: String(row.player1 ?? ''),
    player2: String(row.player2 ?? ''),
    submissionDate: String(row.submission_date ?? ''),
    source: row.source === 'discord' ? 'discord' : 'forum',
    hasDmoFile: Boolean(privateBlobPathname),
    ...(externalUrl ? { externalUrl } : {}),
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

/** The signed-in Match Replay Center lists every submitted record. */
export async function listDmoReplaySubmissions(input: {
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
      private_blob_pathname,file_name,external_url,coach_group_share_consent,
      CASE WHEN coach_group_share_consent IS TRUE
        AND (
          public_share_consent IS TRUE
          OR EXISTS (
            SELECT 1
            FROM dmo_replay_publication_overrides AS publication_override
            WHERE publication_override.submission_id=dmo_submissions.id
              AND publication_override.revoked_at IS NULL
          )
        )
        THEN coach_share_url ELSE NULL END AS coach_share_url
    FROM dmo_submissions
    WHERE (${input.cursor ?? null}::bigint IS NULL OR id < ${input.cursor ?? null}::bigint)
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
    matches: pageRows.map(toDmoReplayCatalogEntry),
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
  if (!row || !isDmoSubmissionPath(row.private_blob_pathname)) return null;

  return {
    ...toPublicReplay(row),
    privateBlobPathname: row.private_blob_pathname,
    fileName: String(row.file_name || `match-${id}.dmo`).slice(0, 120),
  };
}

export async function getDmoReplaySubmission(id: string): Promise<DmoSubmissionReplay | null> {
  const rows = await sql`
    SELECT id::text AS id,tournament,round_name,player1,player2,
      submission_date::text AS submission_date,source,
      private_blob_pathname,file_name,external_url,coach_group_share_consent,
      CASE WHEN coach_group_share_consent IS TRUE
        AND (
          public_share_consent IS TRUE
          OR EXISTS (
            SELECT 1
            FROM dmo_replay_publication_overrides AS publication_override
            WHERE publication_override.submission_id=dmo_submissions.id
              AND publication_override.revoked_at IS NULL
          )
        )
        THEN coach_share_url ELSE NULL END AS coach_share_url
    FROM dmo_submissions
    WHERE id=${id}::bigint
    LIMIT 1
  ` as Array<Record<string, unknown>>;
  const row = rows[0];
  if (!row) return null;
  const catalogEntry = toDmoReplayCatalogEntry(row);
  const privateBlobPathname = catalogEntry.hasDmoFile ? String(row.private_blob_pathname) : null;
  return {
    ...catalogEntry,
    privateBlobPathname,
    fileName: privateBlobPathname ? String(row.file_name || `match-${id}.dmo`).slice(0, 120) : null,
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

export function dmoReplayCatalogMetadata(replay: DmoSubmissionReplay): DmoReplayCatalogEntry {
  const {
    id, tournament, roundName, player1, player2, submissionDate,
    source, hasDmoFile, externalUrl, coachShareUrl,
  } = replay;
  return {
    id,
    tournament,
    roundName,
    player1,
    player2,
    submissionDate,
    source,
    hasDmoFile,
    ...(externalUrl ? { externalUrl } : {}),
    ...(coachShareUrl ? { coachShareUrl } : {}),
  };
}
