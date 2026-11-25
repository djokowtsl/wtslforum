import { NextResponse } from 'next/server';
import { getTournament } from '@/lib/tournaments';
import { getChallongeTournamentId } from '@/lib/challongeBracket';
import { parseChallongeBracketSvg } from '@/lib/challongeBracketData';
import { attachOfficialTournamentResults } from '@/lib/tournamentBracketResults';
import { fetchWTSLTournamentResults } from '@/lib/wtsl';
import { sql } from '@/lib/db';

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

    let bracket = parseChallongeBracketSvg(await response.text());
    let resultsAvailable = true;
    try {
      const normalizedTournamentName = String(tournament.name ?? '')
        .toLocaleLowerCase('en')
        .replace(/[^a-z0-9]/g, '');
      const resultRows = await sql`
        SELECT m.player_one_id, m.player_two_id, p1.name AS player_one_name, p2.name AS player_two_name,
          m.winner_id, m.score, m.stats, m.round_name, m.source_id
        FROM match_stats m
        LEFT JOIN wtsl_players p1
          ON p1.wtsl_player_id=m.player_one_id AND p1.tour=m.tour
        LEFT JOIN wtsl_players p2
          ON p2.wtsl_player_id=m.player_two_id AND p2.tour=m.tour
        WHERE m.tour=${String(tournament.tour)}
          AND m.score IS NOT NULL
          AND (
            m.tournament_key=${challongeId}
            OR lower(regexp_replace(COALESCE(m.tournament_name,''),'[^a-z0-9]','','g'))
              LIKE ${`${normalizedTournamentName}%`}
          )
          AND (
            ${tournament.start_date ?? null}::date IS NULL
            OR m.played_at IS NULL
            OR m.played_at::date BETWEEN ${tournament.start_date ?? null}::date - 3
              AND ${tournament.start_date ?? null}::date + 45
          )
        ORDER BY CASE WHEN COALESCE(m.source_id,'') LIKE 'recent:%' THEN 0 ELSE 1 END,
          m.played_at DESC NULLS LAST
        LIMIT 1000
      `;
      let tournamentPageRows: Awaited<ReturnType<typeof fetchWTSLTournamentResults>> = [];
      try {
        tournamentPageRows = await fetchWTSLTournamentResults(challongeId);
      } catch (error) {
        console.warn(
          'WTSL tournament-page results could not be fetched:',
          error instanceof Error ? error.message : 'unknown error',
        );
      }
      const officialPageRows = tournamentPageRows.map((row) => ({
        player_one_id: row.player1Id,
        player_two_id: row.player2Id,
        player_one_name: row.player1Name,
        player_two_name: row.player2Name,
        winner_id: row.player1Id,
        score: row.score,
        round_name: row.round,
        source_id: `wtsl-tournament-page:${challongeId}`,
        played_at: row.date,
        tournament_name: row.tournamentName,
      }));
      bracket = attachOfficialTournamentResults(bracket, [...officialPageRows, ...resultRows]);
    } catch (error) {
      resultsAvailable = false;
      console.warn(
        'Official tournament results could not be matched to the bracket:',
        error instanceof Error ? error.message : 'unknown error',
      );
    }
    bracket.resultsAvailable = resultsAvailable;
    const allMatches = [...bracket.winners, ...bracket.losers, ...bracket.main]
      .flatMap((round) => round.matches);
    bracket.officialResultCount = allMatches.filter((match) => Boolean(match.officialScore)).length;
    bracket.completedMatchCount = allMatches.filter((match) => match.status === 'complete').length;
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
