import { NextResponse } from 'next/server';
import { wtslCore } from '@/lib/wtsl-core';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const noStore = { 'cache-control': 'no-store, max-age=0' };

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const tour = params.get('tour') || 'all';
  if (!['all', 'atp', 'wta'].includes(tour)) {
    return NextResponse.json(
      { error: 'invalid_tour' },
      { status: 400, headers: noStore },
    );
  }

  const character = params.get('character') || undefined;
  const compare = params.get('compare') || undefined;
  const attribute = params.get('attribute') || undefined;
  const includeProfile = params.get('include_profile') !== 'false';
  const includeOfficial = params.get('include_official') === 'true'
    ? true
    : params.get('include_official') === 'false'
      ? false
      : undefined;
  if ([character, compare, attribute].some((value) => (value?.length || 0) > 120)) {
    return NextResponse.json(
      { error: 'selection_too_long' },
      { status: 400, headers: noStore },
    );
  }

  try {
    const payload = await wtslCore.characterStats({
      tour: tour as 'all' | 'atp' | 'wta',
      character,
      compare,
      attribute,
      includeProfile,
      includeOfficial,
    });
    return NextResponse.json(payload, { headers: noStore });
  } catch (error) {
    const statusCode =
      error && typeof error === 'object' && 'statusCode' in error
        ? Number(error.statusCode)
        : 503;
    const status = [400, 404].includes(statusCode) ? statusCode : 503;
    console.warn('[character-stats] WTSL character feed unavailable', {
      status,
      errorType: error instanceof Error ? error.name : 'UnknownError',
    });
    return NextResponse.json(
      { error: status === 503 ? 'character_stats_unavailable' : 'invalid_selection' },
      { status, headers: noStore },
    );
  }
}
