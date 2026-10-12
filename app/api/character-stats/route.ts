import { NextResponse } from 'next/server';
import { getCharacterPickRanking } from '@/lib/characterPickPopularity.server';
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
    const profile = payload.profile && typeof payload.profile === 'object'
      ? payload.profile as Record<string, unknown>
      : null;
    if (!includeProfile || !profile) {
      return NextResponse.json(payload, { headers: noStore });
    }

    let pick_ranking = null;
    const expectedPicks = Number(profile.pick_count);
    if (
      payload.picks_available === true &&
      String(profile.tour || '').toLowerCase() === 'atp' &&
      Number.isSafeInteger(expectedPicks) &&
      expectedPicks > 0 &&
      typeof profile.character === 'string'
    ) {
      try {
        pick_ranking = await getCharacterPickRanking(profile.character, expectedPicks);
      } catch (rankingError) {
        console.warn('[character-stats] Character pick ranking unavailable', {
          errorType: rankingError instanceof Error ? rankingError.name : 'UnknownError',
        });
      }
    }

    return NextResponse.json({ ...payload, pick_ranking }, { headers: noStore });
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
