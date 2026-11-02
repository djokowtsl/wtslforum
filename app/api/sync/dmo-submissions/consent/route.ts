import { NextRequest, NextResponse } from 'next/server';
import { setDmoSubmissionPublicShareConsent } from '@/lib/dmo-submissions';
import { isWtslSyncAuthorized } from '@/lib/wtslSyncAuth';

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

  if (
    discordChannelId !== DMO_ADMIN_CHANNEL_ID
    || !/^\d{17,20}$/.test(discordMessageId)
    || !/^\d{17,20}$/.test(submitterDiscordId)
    || body?.publicShareConsent !== true
  ) {
    return NextResponse.json({ error: 'The public-sharing confirmation is invalid.' }, { status: 400 });
  }

  const updated = await setDmoSubmissionPublicShareConsent({
    discordChannelId,
    discordMessageId,
    submitterDiscordId,
  });
  if (!updated) {
    return NextResponse.json(
      { error: 'The submission could not be matched to this Discord submitter.' },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true });
}
