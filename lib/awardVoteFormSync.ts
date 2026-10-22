import { createHash, createHmac } from 'node:crypto';

export type AwardFormAnswer = {
  category: string;
  answer: string;
  questionId?: string | null;
};

export type AwardFormBallot = {
  voterKey: string;
  season: string;
  updatedAt: string;
  answers: AwardFormAnswer[];
  previousResponseId?: string | null;
  previousResponseFingerprint?: string | null;
  previousResponseUpdatedAt?: string | null;
};

export type AwardFormSyncStatus = 'ready' | 'not_configured' | 'misconfigured';
export type AwardFormBallotSyncStatus = 'synced' | 'unchanged' | 'stale' | 'failed';

const AWARD_FORM_SYNC_DIAGNOSTIC_CODES = [
  'invalid_request',
  'unauthorized',
  'misconfigured',
  'invalid_ballots',
  'missing_linked_form',
  'linked_form_lookup_failed',
  'unexpected_form_destination',
  'email_collection_unsupported',
  'sync_lock_failed',
  'spreadsheet_access_failed',
  'form_access_failed',
  'form_inspection_failed',
  'response_sheet_not_found_or_ambiguous',
  'response_sheet_setup_failed',
  'previous_response_missing',
  'previous_response_row_missing',
  'incomplete_response_metadata',
  'unmatched_or_unsupported_question',
  'unsupported_required_question',
  'missing_required_answer',
  'form_response_failed',
  'new_response_row_missing',
  'response_metadata_write_failed',
  'ballot_batch_execution_failed',
  'final_spreadsheet_flush_failed',
  'bridge_response_build_failed',
  'sync_lock_release_failed',
  'ballot_sync_failed',
  'sync_failed',
  'bridge_unreachable',
  'bridge_http_error',
  'invalid_bridge_response',
  'stale_response',
  'invalid_ballot_payload',
] as const;

export type AwardFormSyncDiagnosticCode = typeof AWARD_FORM_SYNC_DIAGNOSTIC_CODES[number];

const awardFormSyncDiagnosticCodeSet = new Set<string>(AWARD_FORM_SYNC_DIAGNOSTIC_CODES);

function safeDiagnosticCode(value: unknown): AwardFormSyncDiagnosticCode | undefined {
  return typeof value === 'string' && awardFormSyncDiagnosticCodeSet.has(value)
    ? value as AwardFormSyncDiagnosticCode
    : undefined;
}

export type AwardFormBallotSyncResult = {
  voterKey: string;
  status: AwardFormBallotSyncStatus;
  responseId?: string;
  fingerprint?: string;
  updatedAt?: string;
  diagnosticCode?: AwardFormSyncDiagnosticCode;
};

const MAX_SYNC_BATCH_SIZE = 20;
const MAX_QUESTIONS = 40;
const MIN_SECRET_LENGTH = 32;

function getConfiguration() {
  const endpointValue = process.env.AWARDS_SHEET_WEB_APP_URL?.trim() ?? '';
  const secret = process.env.AWARDS_SHEET_SYNC_SECRET?.trim() ?? '';

  if (!endpointValue && !secret) return { status: 'not_configured' as const };
  if (!endpointValue || secret.length < MIN_SECRET_LENGTH) return { status: 'misconfigured' as const };

  try {
    const endpoint = new URL(endpointValue);
    if (
      endpoint.protocol !== 'https:'
      || endpoint.hostname !== 'script.google.com'
      || endpoint.username
      || endpoint.password
      || endpoint.port
      || endpoint.search
      || endpoint.hash
      || !/^\/macros\/s\/[A-Za-z0-9_-]+\/exec\/?$/.test(endpoint.pathname)
    ) {
      return { status: 'misconfigured' as const };
    }
    return { status: 'ready' as const, endpoint: endpoint.toString(), secret };
  } catch {
    return { status: 'misconfigured' as const };
  }
}

export function awardFormSyncStatus(): AwardFormSyncStatus {
  return getConfiguration().status;
}

export function awardFormBallotFingerprint(season: string, answers: AwardFormAnswer[]) {
  const canonicalAnswers = [...answers]
    .map(({ category, answer, questionId }) => ({
      category: category.trim(),
      answer: answer.trim(),
      questionId: questionId?.trim() || null,
    }))
    .sort((left, right) => left.category.localeCompare(right.category));
  return createHash('sha256')
    .update(JSON.stringify({ season: season.trim(), answers: canonicalAnswers }))
    .digest('hex');
}

function normalizeBallot(ballot: AwardFormBallot, secret: string) {
  const voterKey = String(ballot.voterKey ?? '').trim();
  const season = String(ballot.season ?? '').trim();
  const updatedAt = String(ballot.updatedAt ?? '').trim();
  if (!voterKey || !season || season.length > 40) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(updatedAt) || Number.isNaN(Date.parse(updatedAt))) return null;
  if (!Array.isArray(ballot.answers) || ballot.answers.length < 1 || ballot.answers.length > MAX_QUESTIONS) return null;

  const answers = ballot.answers.map((answer) => ({
    category: String(answer?.category ?? '').trim(),
    answer: String(answer?.answer ?? '').trim(),
    questionId: answer?.questionId == null ? '' : String(answer.questionId).trim(),
  }));
  if (
    answers.some(({ category, answer }) => !category || category.length > 200 || !answer || answer.length > 300)
    || new Set(answers.map(({ category }) => category.toLocaleLowerCase())).size !== answers.length
    || answers.some(({ questionId }) => questionId.length > 100 || (questionId && !/^[A-Za-z0-9_-]+$/.test(questionId)))
  ) {
    return null;
  }

  const canonicalAnswers = [...answers].sort((left, right) => left.category.localeCompare(right.category));
  const fingerprint = awardFormBallotFingerprint(season, canonicalAnswers);
  const voterToken = createHmac('sha256', secret)
    .update(`${season}\0${voterKey}`)
    .digest('hex');
  const previousResponseId = ballot.previousResponseId == null ? '' : String(ballot.previousResponseId).trim();
  if (previousResponseId && !/^[A-Za-z0-9_-]{1,200}$/.test(previousResponseId)) return null;
  const previousResponseFingerprint = ballot.previousResponseFingerprint == null
    ? ''
    : String(ballot.previousResponseFingerprint).trim();
  const previousResponseUpdatedAt = ballot.previousResponseUpdatedAt == null
    ? ''
    : String(ballot.previousResponseUpdatedAt).trim();
  if (previousResponseFingerprint && !/^[a-f0-9]{64}$/.test(previousResponseFingerprint)) return null;
  if (previousResponseUpdatedAt && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(previousResponseUpdatedAt)) return null;

  return {
    voterKey,
    request: {
      voterToken,
      season: season.slice(0, 40),
      updatedAt,
      fingerprint,
      answers: canonicalAnswers.map(({ category, answer, questionId }) => ({
        category,
        answer,
        ...(questionId ? { questionId } : {}),
      })),
      ...(previousResponseId ? { previousResponseId } : {}),
      ...(previousResponseFingerprint ? { previousResponseFingerprint } : {}),
      ...(previousResponseUpdatedAt ? { previousResponseUpdatedAt } : {}),
    },
  };
}

async function postBatch(
  endpoint: string,
  secret: string,
  ballots: NonNullable<ReturnType<typeof normalizeBallot>>[],
): Promise<{
  results: AwardFormBallotSyncResult[] | null;
  diagnosticCode?: AwardFormSyncDiagnosticCode;
}> {
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ secret, ballots: ballots.map(({ request }) => request) }),
      signal: AbortSignal.timeout(20_000),
    });
    const result = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok || result?.ok !== true || !Array.isArray(result.results) || result.results.length !== ballots.length) {
      const fallbackCode = !response.ok
        ? 'bridge_http_error'
        : result?.ok === false
          ? 'sync_failed'
          : 'invalid_bridge_response';
      return {
        results: null,
        diagnosticCode: safeDiagnosticCode(result?.error)
          ?? fallbackCode,
      };
    }

    const results = result.results.map((item: unknown, index: number): AwardFormBallotSyncResult => {
      const value = item && typeof item === 'object' ? item as Record<string, unknown> : null;
      const status = value?.status;
      if (status === 'failed') {
        return {
          voterKey: ballots[index].voterKey,
          status: 'failed',
          diagnosticCode: safeDiagnosticCode(value?.errorCode) ?? 'ballot_sync_failed',
        };
      }
      const responseId = typeof value?.responseId === 'string' ? value.responseId : undefined;
      const fingerprint = typeof value?.fingerprint === 'string' ? value.fingerprint : undefined;
      const updatedAt = typeof value?.updatedAt === 'string' ? value.updatedAt : undefined;
      if (
        !value
        || !['synced', 'unchanged', 'stale'].includes(String(status))
        || !responseId
        || !/^[A-Za-z0-9_-]{1,200}$/.test(responseId)
        || !fingerprint
        || !/^[a-f0-9]{64}$/.test(fingerprint)
        || (status !== 'stale' && fingerprint !== ballots[index].request.fingerprint)
        || !updatedAt
        || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(updatedAt)
      ) {
        return {
          voterKey: ballots[index].voterKey,
          status: 'failed',
          diagnosticCode: 'invalid_bridge_response',
        };
      }
      return {
        voterKey: ballots[index].voterKey,
        status: status as AwardFormBallotSyncStatus,
        responseId,
        fingerprint,
        updatedAt,
        ...(status === 'stale' ? { diagnosticCode: 'stale_response' as const } : {}),
      };
    });
    const diagnosticCode = results.find((item) => item.diagnosticCode)?.diagnosticCode;
    return { results, ...(diagnosticCode ? { diagnosticCode } : {}) };
  } catch {
    return { results: null, diagnosticCode: 'bridge_unreachable' };
  }
}

/** Sends complete ballots to the Forms service; raw Discord IDs never leave the Forum server. */
export async function syncAwardBallotsToForm(ballots: AwardFormBallot[]) {
  const configuration = getConfiguration();
  if (configuration.status !== 'ready') {
    return {
      status: configuration.status,
      results: [] as AwardFormBallotSyncResult[],
      failed: ballots.length,
    };
  }

  const normalized = ballots.map((ballot) => normalizeBallot(ballot, configuration.secret));
  if (normalized.some((ballot) => ballot === null)) {
    return {
      status: 'failed' as const,
      results: [] as AwardFormBallotSyncResult[],
      failed: ballots.length,
      diagnosticCode: 'invalid_ballot_payload' as const,
    };
  }

  const results: AwardFormBallotSyncResult[] = [];
  let failed = 0;
  let diagnosticCode: AwardFormSyncDiagnosticCode | undefined;
  for (let index = 0; index < normalized.length; index += MAX_SYNC_BATCH_SIZE) {
    const batch = normalized.slice(index, index + MAX_SYNC_BATCH_SIZE) as NonNullable<typeof normalized[number]>[];
    const batchResults = await postBatch(configuration.endpoint, configuration.secret, batch);
    if (!batchResults.results) {
      failed += batch.length;
      diagnosticCode ??= batchResults.diagnosticCode ?? 'invalid_bridge_response';
      results.push(...batch.map(({ voterKey }) => ({
        voterKey,
        status: 'failed' as const,
        diagnosticCode: batchResults.diagnosticCode ?? 'invalid_bridge_response',
      })));
      continue;
    }
    failed += batchResults.results.filter((result) => result.status === 'failed').length;
    diagnosticCode ??= batchResults.diagnosticCode;
    results.push(...batchResults.results);
  }

  return {
    status: failed ? 'failed' as const : 'synced' as const,
    results,
    failed,
    ...(diagnosticCode ? { diagnosticCode } : {}),
  };
}
