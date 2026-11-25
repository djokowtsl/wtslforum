import { NextResponse } from 'next/server';
import { getTournament } from '@/lib/tournaments';
import { getChallongeTournamentId } from '@/lib/challongeBracket';
import { parseChallongeBracketSvg } from '@/lib/challongeBracketData';

export const runtime = 'nodejs';

const TOURNAMENT_KEY_PATTERN = /^[a-z0-9-]{1,160}$/;
const CHALLONGE_HOST = 'https://91d510368cb4170cd5ac3776.challonge.com';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key } = await params;
  if (!TOURNAMENT_KEY_PATTERN.test(key)) {
    return NextResponse.json({ error: 'Tournament not found.' }, { status: 404 });
  }

  try {
    const tournament = await getTournament(key);
    if (!tournament) {
      return NextResponse.json({ error: 'Tournament not found.' }, { status: 404 });
    }

    const challongeId = getChallongeTournamentId(String(tournament.official_url ?? ''));
    if (!challongeId) {
      return NextResponse.json({ error: 'No Challonge draw is linked.' }, { status: 404 });
    }

    const response = await fetch(
      `${CHALLONGE_HOST}/${encodeURIComponent(challongeId)}.svg`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; WTSL-Community-Forum/1.0)',
          Accept: 'image/svg+xml,text/xml;q=0.9,*/*;q=0.8',
        },
        next: { revalidate: 300 },
      },
    );
    if (!response.ok) {
      console.error(`Challonge bracket request failed with HTTP ${response.status}.`);
      return NextResponse.json(
        { error: 'The Challonge draw is temporarily unavailable.' },
        { status: 502 },
      );
    }

    const bracket = parseChallongeBracketSvg(await response.text());
    return NextResponse.json(bracket, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    console.error(
      'Could not build the tournament bracket:',
      error instanceof Error ? error.message : 'unknown error',
    );
    return NextResponse.json(
      { error: 'The tournament bracket could not be generated.' },
      { status: 502 },
    );
  }
}
