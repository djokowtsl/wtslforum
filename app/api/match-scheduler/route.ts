import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { wtslCore } from '@/lib/wtsl-core';

export const dynamic = 'force-dynamic';

const schedulerAction = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create'),
    tournament_id: z.string().trim().min(1).max(100),
    match_id: z.string().trim().min(1).max(100),
    availability_timezone: z.string().trim().max(80).optional(),
    availability_windows: z.array(z.object({
      start_utc: z.string().trim().min(10).max(50),
      end_utc: z.string().trim().min(10).max(50),
    })).max(5).optional(),
  }),
  z.object({
    action: z.literal('propose'),
    schedule_id: z.string().trim().min(1).max(50),
    slots: z.array(z.string().trim().min(10).max(50)).min(1).max(3),
    timezone: z.string().trim().min(1).max(80),
  }),
  z.object({
    action: z.literal('confirm'),
    schedule_id: z.string().trim().min(1).max(50),
    slot_utc: z.string().trim().min(10).max(50),
  }),
  z.object({
    action: z.literal('request_extension'),
    schedule_id: z.string().trim().min(1).max(50),
    reason: z.string().trim().min(10).max(500),
  }),
]);

function coreErrorResponse(error: unknown) {
  const statusCode = Number(
    (error as Error & { statusCode?: number })?.statusCode,
  );
  const status = statusCode >= 400 && statusCode <= 599 ? statusCode : 502;
  return NextResponse.json(
    {
      error:
        error instanceof Error
          ? error.message
          : 'The match scheduler is temporarily unavailable.',
    },
    { status },
  );
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json(
      { error: 'Sign in with Discord to view this schedule.' },
      { status: 401 },
    );
  }
  const scheduleId = request.nextUrl.searchParams.get('schedule_id')?.trim();
  if (!scheduleId || scheduleId.length > 50) {
    return NextResponse.json(
      { error: 'A valid schedule ID is required.' },
      { status: 400 },
    );
  }

  try {
    const result = await wtslCore.matchSchedulerDetail(
      session.discordId,
      scheduleId,
    );
    return NextResponse.json(result, {
      headers: { 'cache-control': 'private, no-store' },
    });
  } catch (error) {
    return coreErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json(
      { error: 'Sign in with Discord to use the match scheduler.' },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }
  const parsed = schedulerAction.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Check the match and time details, then try again.' },
      { status: 400 },
    );
  }

  try {
    const result = await wtslCore.matchSchedulerAction(
      session.discordId,
      parsed.data,
    );
    return NextResponse.json(result);
  } catch (error) {
    return coreErrorResponse(error);
  }
}
