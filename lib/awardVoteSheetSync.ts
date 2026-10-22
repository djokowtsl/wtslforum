export type AwardVoteSheetRow = {
  voteId: string | number | bigint;
  season: string;
  category: string;
  nominee: string | null;
  writeIn: string | null;
  castAt: string | Date;
  voterKey?: string;
};

export type AwardVoteSheetSyncStatus = 'ready' | 'not_configured' | 'misconfigured';

const MAX_SYNC_BATCH_SIZE = 100;
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

export function awardVoteSheetSyncStatus(): AwardVoteSheetSyncStatus {
  return getConfiguration().status;
}

function normalizeVote(vote: AwardVoteSheetRow) {
  const voteId = String(vote.voteId ?? '');
  const rawCastAt = vote.castAt instanceof Date ? vote.castAt.toISOString() : String(vote.castAt ?? '').trim();
  const timestampMatch = rawCastAt.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?Z$/);
  const castAt = timestampMatch && !Number.isNaN(Date.parse(rawCastAt))
    ? `${timestampMatch[1]}.${(timestampMatch[2] ?? '').padEnd(6, '0')}Z`
    : null;
  const season = String(vote.season ?? '').trim();
  const category = String(vote.category ?? '').trim();
  if (!/^\d{1,20}$/.test(voteId) || !season || !category || !castAt) return null;

  return {
    voteId,
    season: season.slice(0, 40),
    category: category.slice(0, 200),
    nominee: typeof vote.nominee === 'string' ? vote.nominee.slice(0, 300) : null,
    writeIn: typeof vote.writeIn === 'string' ? vote.writeIn.slice(0, 300) : null,
    castAt,
  };
}

async function postBatch(endpoint: string, secret: string, votes: ReturnType<typeof normalizeVote>[]) {
  if (votes.some((vote) => vote === null)) return false;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ secret, votes }),
      signal: AbortSignal.timeout(10_000),
    });
    const result = await response.json().catch(() => null);
    return response.ok && result?.ok === true;
  } catch {
    return false;
  }
}

/** Sends a privacy-limited vote snapshot; Discord IDs are never included. */
export async function syncAwardVotesToSheet(votes: AwardVoteSheetRow[]) {
  const configuration = getConfiguration();
  if (configuration.status !== 'ready') {
    return { status: configuration.status, synced: 0, failed: votes.length };
  }

  let synced = 0;
  let failed = 0;
  for (let index = 0; index < votes.length; index += MAX_SYNC_BATCH_SIZE) {
    const batch = votes.slice(index, index + MAX_SYNC_BATCH_SIZE).map(normalizeVote);
    if (await postBatch(configuration.endpoint, configuration.secret, batch)) {
      synced += batch.length;
    } else {
      failed += batch.length;
    }
  }

  return { status: failed ? 'failed' as const : 'synced' as const, synced, failed };
}
