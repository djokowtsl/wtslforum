import { sql } from '@/lib/db';
import { getSiteAwardBallot, saveAwardFormResponseState } from '@/lib/awards';
import {
  awardFormBallotFingerprint,
  syncAwardBallotsToForm,
} from '@/lib/awardVoteFormSync';

export type AwardFormSyncJobStatus =
  | 'queued'
  | 'processing'
  | 'waiting_required'
  | 'synced'
  | 'retryable'
  | 'needs_review';

export type AwardFormSyncSummary = {
  counts: Record<AwardFormSyncJobStatus, number>;
  recentIssues: Array<{
    reference: string;
    status: 'retryable' | 'needs_review';
    attempts: number;
    lastAttemptAt: string | null;
    errorCode: string | null;
  }>;
};

const SAFE_RETRY_CODES = new Set([
  'not_configured',
  'misconfigured',
  'invalid_ballot_payload',
  'sync_lock_failed',
  'form_inspection_failed',
  'form_response_preflight_failed',
  'form_response_creation_failed',
  'form_item_response_failed',
  'unmatched_or_unsupported_question',
  'unsupported_required_question',
  'missing_required_answer',
  'response_sheet_not_found_or_ambiguous',
  'response_sheet_setup_failed',
]);

function safeErrorCode(value: unknown) {
  const code = typeof value === 'string' ? value : '';
  return /^[a-z0-9_]{1,80}$/.test(code) ? code : 'unknown_sync_error';
}

export async function enqueueAwardFormSyncJob(
  cycleId: number,
  voterKey: string,
  fingerprint: string,
  updatedAt: string,
) {
  const rows = await sql`
    INSERT INTO award_form_sync_jobs (
      cycle_id, voter_key, desired_fingerprint, desired_updated_at, status
    )
    VALUES (${cycleId}, ${voterKey}, ${fingerprint}, ${updatedAt}::timestamptz, 'queued')
    ON CONFLICT (cycle_id, voter_key)
    DO UPDATE SET
      desired_fingerprint=EXCLUDED.desired_fingerprint,
      desired_updated_at=EXCLUDED.desired_updated_at,
      status=CASE
        WHEN award_form_sync_jobs.status IN ('processing', 'needs_review')
          THEN award_form_sync_jobs.status
        ELSE 'queued'
      END,
      attempt_count=CASE
        WHEN award_form_sync_jobs.desired_fingerprint <> EXCLUDED.desired_fingerprint
          THEN 0
        ELSE award_form_sync_jobs.attempt_count
      END,
      next_attempt_at=NOW(),
      lease_until=CASE
        WHEN award_form_sync_jobs.status = 'processing' THEN award_form_sync_jobs.lease_until
        ELSE NULL
      END,
      last_error_code=CASE
        WHEN award_form_sync_jobs.status = 'needs_review' THEN award_form_sync_jobs.last_error_code
        ELSE NULL
      END,
      updated_at=NOW()
    RETURNING id::text AS id, status
  `;
  return rows[0] as { id: string; status: AwardFormSyncJobStatus };
}

export async function getAwardFormSyncJob(cycleId: number, voterKey: string) {
  const rows = await sql`
    SELECT status, attempt_count AS attempts, last_error_code AS "errorCode"
    FROM award_form_sync_jobs
    WHERE cycle_id=${cycleId} AND voter_key=${voterKey}
    LIMIT 1
  `;
  return rows[0] as {
    status: AwardFormSyncJobStatus;
    attempts: number;
    errorCode: string | null;
  } | undefined;
}

export async function getAwardFormSyncJobById(cycleId: number, jobId: string) {
  const rows = await sql`
    SELECT
      id::text AS id,
      voter_key AS "voterKey",
      status,
      desired_fingerprint AS "desiredFingerprint"
    FROM award_form_sync_jobs
    WHERE cycle_id=${cycleId} AND id=${jobId}::bigint
    LIMIT 1
  `;
  return rows[0] as {
    id: string;
    voterKey: string;
    status: AwardFormSyncJobStatus;
    desiredFingerprint: string;
  } | undefined;
}

export async function getAwardFormSyncJobStatuses(cycleId: number, voterKeys: string[]) {
  if (!voterKeys.length) return new Map<string, AwardFormSyncJobStatus>();
  const rows = await sql`
    SELECT voter_key AS "voterKey", status
    FROM award_form_sync_jobs
    WHERE cycle_id=${cycleId} AND voter_key=ANY(${voterKeys})
  `;
  return new Map(
    (rows as Array<{ voterKey: string; status: AwardFormSyncJobStatus }>)
      .map((row) => [row.voterKey, row.status]),
  );
}

export async function markAwardFormSyncJobSynced(
  cycleId: number,
  voterKey: string,
  fingerprint: string,
  updatedAt: string,
) {
  await sql`
    INSERT INTO award_form_sync_jobs (
      cycle_id, voter_key, desired_fingerprint, desired_updated_at, status, synced_at
    )
    VALUES (
      ${cycleId}, ${voterKey}, ${fingerprint}, ${updatedAt}::timestamptz, 'synced', NOW()
    )
    ON CONFLICT (cycle_id, voter_key)
    DO UPDATE SET
      desired_fingerprint=EXCLUDED.desired_fingerprint,
      desired_updated_at=EXCLUDED.desired_updated_at,
      status=CASE
        WHEN award_form_sync_jobs.status = 'processing'
          AND award_form_sync_jobs.desired_fingerprint <> EXCLUDED.desired_fingerprint
          THEN 'processing'
        ELSE 'synced'
      END,
      last_error_code=NULL,
      lease_until=CASE
        WHEN award_form_sync_jobs.status = 'processing' THEN award_form_sync_jobs.lease_until
        ELSE NULL
      END,
      synced_at=NOW(),
      updated_at=NOW()
  `;
}

export async function getAwardFormSyncSummary(cycleId: number): Promise<AwardFormSyncSummary> {
  await sql`
    UPDATE award_form_sync_jobs
    SET status='needs_review', last_error_code='worker_lease_expired',
        lease_until=NULL, updated_at=NOW()
    WHERE cycle_id=${cycleId}
      AND status='processing'
      AND lease_until < NOW()
  `;
  const counts: AwardFormSyncSummary['counts'] = {
    queued: 0,
    processing: 0,
    waiting_required: 0,
    synced: 0,
    retryable: 0,
    needs_review: 0,
  };
  const [grouped, issues] = await Promise.all([
    sql`
      SELECT status, COUNT(*)::int AS count
      FROM award_form_sync_jobs
      WHERE cycle_id=${cycleId}
      GROUP BY status
    `,
    sql`
      SELECT
        id::text AS reference,
        status,
        attempt_count AS attempts,
        last_attempt_at AS "lastAttemptAt",
        last_error_code AS "errorCode"
      FROM award_form_sync_jobs
      WHERE cycle_id=${cycleId} AND status IN ('retryable', 'needs_review')
      ORDER BY updated_at DESC
      LIMIT 10
    `,
  ]);
  for (const row of grouped as Array<{ status: AwardFormSyncJobStatus; count: number }>) {
    if (row.status in counts) counts[row.status] = Number(row.count);
  }
  return { counts, recentIssues: issues as AwardFormSyncSummary['recentIssues'] };
}

export async function retrySafeAwardFormSyncJobs(cycleId: number) {
  const rows = await sql`
    UPDATE award_form_sync_jobs
    SET status='queued', next_attempt_at=NOW(), lease_until=NULL,
        last_error_code=NULL, updated_at=NOW()
    WHERE cycle_id=${cycleId} AND status='retryable'
    RETURNING id::text AS id
  `;
  return rows.map((row) => String(row.id));
}

export async function getQueuedAwardFormSyncJobIds(cycleId: number, limit = 20) {
  const rows = await sql`
    SELECT id::text AS id
    FROM award_form_sync_jobs
    WHERE cycle_id=${cycleId} AND status='queued' AND next_attempt_at <= NOW()
    ORDER BY updated_at
    LIMIT ${limit}
  `;
  return rows.map((row) => String(row.id));
}

async function claimAwardFormSyncJob(jobId: string) {
  const rows = await sql`
    UPDATE award_form_sync_jobs
    SET status='processing', attempt_count=attempt_count+1,
        last_attempt_at=NOW(), lease_until=NOW() + INTERVAL '3 minutes',
        updated_at=NOW()
    WHERE id=${jobId}::bigint AND status='queued' AND next_attempt_at <= NOW()
    RETURNING id::text AS id, cycle_id AS "cycleId", voter_key AS "voterKey",
      desired_fingerprint AS fingerprint,
      to_char(desired_updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "updatedAt"
  `;
  return rows[0] as {
    id: string;
    cycleId: number;
    voterKey: string;
    fingerprint: string;
    updatedAt: string;
  } | undefined;
}

async function finishAwardFormSyncJob(
  jobId: string,
  snapshotFingerprint: string,
  status: AwardFormSyncJobStatus,
  errorCode: string | null = null,
) {
  const rows = await sql`
    UPDATE award_form_sync_jobs
    SET status=CASE
          WHEN desired_fingerprint <> ${snapshotFingerprint} AND ${status} = 'needs_review' THEN 'needs_review'
          WHEN desired_fingerprint <> ${snapshotFingerprint} THEN 'queued'
          ELSE ${status}
        END,
        attempt_count=CASE
          WHEN desired_fingerprint <> ${snapshotFingerprint} AND ${status} <> 'needs_review' THEN 0
          ELSE attempt_count
        END,
        last_error_code=CASE
          WHEN desired_fingerprint <> ${snapshotFingerprint} AND ${status} = 'needs_review' THEN ${errorCode}
          WHEN desired_fingerprint <> ${snapshotFingerprint} THEN NULL
          ELSE ${errorCode}
        END,
        next_attempt_at=CASE
          WHEN desired_fingerprint <> ${snapshotFingerprint} THEN NOW()
          WHEN ${status} = 'retryable' THEN NOW() + INTERVAL '1 minute'
          ELSE NOW()
        END,
        lease_until=NULL,
        synced_at=CASE
          WHEN desired_fingerprint = ${snapshotFingerprint} AND ${status} = 'synced' THEN NOW()
          ELSE synced_at
        END,
        updated_at=NOW()
    WHERE id=${jobId}::bigint
    RETURNING status
  `;
  return rows[0]?.status as AwardFormSyncJobStatus | undefined;
}

export async function processAwardFormSyncJob(jobId: string) {
  for (let pass = 0; pass < 2; pass += 1) {
    const job = await claimAwardFormSyncJob(jobId);
    if (!job) return;

    try {
      const ballot = await getSiteAwardBallot(job.cycleId, job.voterKey);
      if (!ballot || !ballot.isComplete) {
        await finishAwardFormSyncJob(job.id, job.fingerprint, 'waiting_required');
        return;
      }

      const fingerprint = awardFormBallotFingerprint(ballot.season, ballot.answers);
      if (fingerprint !== job.fingerprint) {
        await finishAwardFormSyncJob(job.id, job.fingerprint, 'queued');
        continue;
      }

      if (ballot.responseFingerprint === fingerprint && ballot.previousResponseId) {
        const state = await finishAwardFormSyncJob(job.id, fingerprint, 'synced');
        if (state === 'queued') continue;
        return;
      }

      const sync = await syncAwardBallotsToForm([ballot]);
      const result = sync.results[0];
      const acceptedStatus = result?.status === 'synced'
        || result?.status === 'unchanged'
        || result?.status === 'stale';

      if (
        acceptedStatus
        && result?.responseId
        && result.fingerprint
        && result.updatedAt
      ) {
        await saveAwardFormResponseState(
          job.cycleId,
          job.voterKey,
          result.responseId,
          result.fingerprint,
          result.updatedAt,
        );
        const latestBallot = await getSiteAwardBallot(job.cycleId, job.voterKey);
        const latestFingerprint = latestBallot
          ? awardFormBallotFingerprint(latestBallot.season, latestBallot.answers)
          : '';
        const nextStatus = latestFingerprint === result.fingerprint ? 'synced' : 'queued';
        const state = await finishAwardFormSyncJob(job.id, fingerprint, nextStatus);
        if (state === 'queued' && pass === 0) continue;
        return;
      }

      const diagnosticCode = safeErrorCode(
        result?.diagnosticCode
          ?? ('diagnosticCode' in sync ? sync.diagnosticCode : undefined)
          ?? sync.status,
      );
      const failureStatus = SAFE_RETRY_CODES.has(diagnosticCode) ? 'retryable' : 'needs_review';
      const state = await finishAwardFormSyncJob(job.id, fingerprint, failureStatus, diagnosticCode);
      if (state === 'queued' && pass === 0) continue;
      return;
    } catch {
      await finishAwardFormSyncJob(job.id, job.fingerprint, 'needs_review', 'worker_error');
      return;
    }
  }
}

export async function processAwardFormSyncQueue(cycleId: number, limit = 20) {
  const ids = await getQueuedAwardFormSyncJobIds(cycleId, limit);
  for (const id of ids) await processAwardFormSyncJob(id);
  return ids.length;
}
