import { NextRequest, NextResponse } from 'next/server';
import {
  findDmoSubmissionByDiscordMessage,
  setDmoSubmissionPublicShareConsent,
} from '@/lib/dmo-submissions';
import { isWtslSyncAuthorized } from '@/lib/wtslSyncAuth';
import { syncPublicDmoSubmissionToTe4CoachGroup } from '@/lib/te4CoachGroupServer';
import { parseTe4CoachShareUrl } from '@/lib/te4CoachEmbed';

export const dynamic = 'force-dynamic';

const DMO_ADMIN_CHANNEL_ID = '1055277431398866995';

function cleanText(value: unknown, maxLength: number) {
  return String(value ?? '').trim().slice(0, maxLength);
}

export async function POST(req: NextRequest) {
  if (!isWtslSyncAuthorized(req.headers)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const discordChannelId = cleanText(body?.discordChannelId, 32);
  const discordMessageId = cleanText(body?.discordMessageId, 32);
  const submitterDiscordId = cleanText(body?.submitterDiscordId, 32);
  const coachGroupShareConsent = body?.coachGroupShareConsent === true;
  const coachShare = parseTe4CoachShareUrl(cleanText(body?.coachShareUrl, 500));

  if (
    discordChannelId !== DMO_ADMIN_CHANNEL_ID
    || !/^\d{17,20}$/.test(discordMessageId)
    || !/^\d{17,20}$/.test(submitterDiscordId)
    || body?.publicShareConsent !== true
    || (
      body?.coachGroupShareConsent !== undefined
      && typeof body.coachGroupShareConsent !== 'boolean'
    )
    || !coachShare.valid
    || (coachGroupShareConsent && !coachShare.url)
  ) {
    return NextResponse.json({ error: 'The public-sharing confirmation is invalid.' }, { status: 400 });
  }

  const updated = await setDmoSubmissionPublicShareConsent({
    discordChannelId,
    discordMessageId,
    submitterDiscordId,
    coachGroupShareConsent,
    coachShareUrl: coachShare.url,
  });
  if (!updated) {
    return NextResponse.json(
      { error: 'The submission could not be matched to this Discord submitter.' },
      { status: 404 },
    );
  }

  let coachGroupSync: 'synced' | 'skipped' | 'not_configured' | 'failed' = 'skipped';
  try {
    const submission = await findDmoSubmissionByDiscordMessage(
      discordChannelId,
      discordMessageId,
    );
    if (submission) {
      coachGroupSync = (
        await syncPublicDmoSubmissionToTe4CoachGroup(String(submission.id))
      ).status;
    }
  } catch (error) {
    coachGroupSync = 'failed';
    console.error('[dmo] consent saved; Coach group sync failed', {
      errorType: error instanceof Error ? error.name : 'UnknownError',
    });
  }

  return NextResponse.json({ ok: true, coachGroupSync });
}
