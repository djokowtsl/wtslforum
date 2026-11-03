import 'server-only';
import {
  getPublicDmoCoachReplay,
  isDmoReplayId,
  type PublicDmoReplay,
} from '@/lib/dmoReplayLibrary';
import { buildTe4CoachGroupEntry } from '@/lib/te4CoachGroup';
import { buildTe4CoachGroupMatchUrl } from '@/lib/te4CoachEmbed';

const TE4_COACH_API = 'https://replays.knowthew.net/api/groups';

export type Te4CoachGroupSyncResult = {
  status: 'synced' | 'skipped' | 'not_configured' | 'failed';
  httpStatus?: number;
  pending?: number;
  problems?: number;
};

function groupCredentials() {
  const groupId = process.env.TE4_COACH_GROUP_ID ?? '';
  const editCode = process.env.TE4_COACH_GROUP_EDIT_CODE ?? '';
  return /^[A-Za-z0-9_-]{1,80}$/.test(groupId) && editCode
    ? { groupId, editCode }
    : null;
}

async function postGroupChange(
  action: 'add' | 'remove',
  links: unknown[],
): Promise<Te4CoachGroupSyncResult> {
  const credentials = groupCredentials();
  if (!credentials) return { status: 'not_configured' };
  try {
    const response = await fetch(
      `${TE4_COACH_API}/${encodeURIComponent(credentials.groupId)}/${action}`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-edit': credentials.editCode,
        },
        body: JSON.stringify({ links }),
        cache: 'no-store',
        signal: AbortSignal.timeout(12_000),
      },
    );
    const body = await response.json().catch(() => null);
    if (!response.ok) return { status: 'failed', httpStatus: response.status };
    return {
      status: 'synced',
      pending: Number.isSafeInteger(body?.pending) ? body.pending : undefined,
      problems: Number.isSafeInteger(body?.problems) ? body.problems : undefined,
    };
  } catch {
    return { status: 'failed' };
  }
}

async function addPublicDmoReplayToTe4CoachGroup(
  replay: PublicDmoReplay,
): Promise<Te4CoachGroupSyncResult> {
  const entry = buildTe4CoachGroupEntry(replay);
  if (!entry) return { status: 'skipped' };
  return postGroupChange('add', [entry]);
}

export async function removeTe4CoachLinkFromGroup(
  value: unknown,
): Promise<Te4CoachGroupSyncResult> {
  const link = buildTe4CoachGroupMatchUrl(value);
  if (!link) return { status: 'skipped' };
  return postGroupChange('remove', [link]);
}

export async function syncPublicDmoSubmissionToTe4CoachGroup(
  id: string,
): Promise<Te4CoachGroupSyncResult> {
  if (!isDmoReplayId(id)) return { status: 'skipped' };
  const replay = await getPublicDmoCoachReplay(id);
  if (!replay?.coachShareUrl) return { status: 'skipped' };
  return addPublicDmoReplayToTe4CoachGroup(replay);
}
