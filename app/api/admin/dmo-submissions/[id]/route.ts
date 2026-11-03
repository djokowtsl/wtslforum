import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getDmoSubmission, updateDmoSubmissionTags } from '@/lib/dmo-submissions';
import { parseTe4CoachShareUrl } from '@/lib/te4CoachEmbed';
import {
  removeTe4CoachLinkFromGroup,
  syncPublicDmoSubmissionToTe4CoachGroup,
} from '@/lib/te4CoachGroupServer';
import { buildTe4CoachGroupMatchUrl } from '@/lib/te4CoachEmbed';

export const dynamic = 'force-dynamic';

function cleanRequiredText(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
}

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSession();
  if (!user?.isAdmin) {
    return NextResponse.json({ error: 'Admin access required.' }, { status: 403 });
  }

  const { id } = await params;
  const submissionId = Number(id);
  if (!Number.isSafeInteger(submissionId) || submissionId < 1) {
    return NextResponse.json({ error: 'Invalid submission id.' }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const tournament = cleanRequiredText(body?.tournament, 100);
  const roundName = cleanRequiredText(body?.roundName, 60);
  const player1 = cleanRequiredText(body?.player1, 100);
  const player2 = cleanRequiredText(body?.player2, 100);
  const submissionDate = body?.submissionDate;
  const hasCoachShareUrl = body !== null
    && typeof body === 'object'
    && Object.prototype.hasOwnProperty.call(body, 'coachShareUrl');
  const coachShare = hasCoachShareUrl
    ? parseTe4CoachShareUrl(body.coachShareUrl)
    : undefined;

  if (!tournament || !roundName || !player1 || !player2 || !validDate(submissionDate)) {
    return NextResponse.json(
      { error: 'Tournament, round, both players, and a valid submission date are required.' },
      { status: 400 },
    );
  }
  if (coachShare && !coachShare.valid) {
    return NextResponse.json(
      { error: 'Use an HTTPS TE4 Coach match link from /m, /tv, or a /w dashboard match.' },
      { status: 400 },
    );
  }

  const previous = await getDmoSubmission(submissionId);
  if (!previous) {
    return NextResponse.json({ error: 'DMO submission not found.' }, { status: 404 });
  }
  const oldGroupLink = buildTe4CoachGroupMatchUrl(previous.coach_share_url);
  const newGroupLink = coachShare
    ? buildTe4CoachGroupMatchUrl(coachShare.url)
    : oldGroupLink;
  const resetCoachGroupConsent = Boolean(coachShare && oldGroupLink !== newGroupLink);
  const updated = await updateDmoSubmissionTags(submissionId, {
    tournament,
    roundName,
    player1,
    player2,
    submissionDate,
    ...(coachShare
      ? { coachShareUrl: coachShare.url, resetCoachGroupConsent }
      : {}),
  });
  if (!updated) {
    return NextResponse.json({ error: 'DMO submission not found.' }, { status: 404 });
  }

  let oldLinkRemovalFailed = false;
  if (oldGroupLink && oldGroupLink !== newGroupLink) {
    oldLinkRemovalFailed = (
      await removeTe4CoachLinkFromGroup(oldGroupLink)
    ).status === 'failed';
  }
  let coachGroupSync: 'synced' | 'skipped' | 'not_configured' | 'failed' = 'skipped';
  try {
    coachGroupSync = (
      await syncPublicDmoSubmissionToTe4CoachGroup(String(submissionId))
    ).status;
  } catch (error) {
    coachGroupSync = 'failed';
    console.error('[dmo] admin tag saved; Coach group sync failed', {
      id: submissionId,
      errorType: error instanceof Error ? error.name : 'UnknownError',
    });
  }
  return NextResponse.json({
    ok: true,
    coachGroupSync: oldLinkRemovalFailed ? 'failed' : coachGroupSync,
    coachGroupConsentReset: Boolean(
      resetCoachGroupConsent
      && previous.coach_group_share_consent
      && updated.coach_share_url,
    ),
  });
}
