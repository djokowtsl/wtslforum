import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getTournament } from '@/lib/tournaments';
import { getChallongeTournamentId } from '@/lib/challongeBracket';
import { wtslCore } from '@/lib/wtsl-core';
import { fetchWTSLTournamentResults } from '@/lib/wtsl';
import {
  dedupeEquivalentOfficialMeetings,
  normalizeBracketPlayerName,
  normalizeOfficialResultScore,
  orientOfficialScore,
} from '@/lib/tournamentBracketResults';

export const runtime = 'nodejs';
export const maxDuration = 25;

const KEY_PATTERN = /^[a-z0-9-]{1,160}$/;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key } = await params;
  if (!KEY_PATTERN.test(key)) {
    return NextResponse.json({ error: 'Tournament not found.' }, { status: 404 });
  }

  const url = new URL(request.url);
  const firstName = (url.searchParams.get('first') ?? '').trim().slice(0, 120);
  const secondName = (url.searchParams.get('second') ?? '').trim().slice(0, 120);
  const firstCharacter = (url.searchParams.get('firstCharacter') ?? '').trim().slice(0, 80) || null;
  const secondCharacter = (url.searchParams.get('secondCharacter') ?? '').trim().slice(0, 80) || null;
  const roundName = (url.searchParams.get('round') ?? '').trim().slice(0, 80);
  const requestedScore = (url.searchParams.get('score') ?? '').trim().slice(0, 120);
  const requestedWinner = (url.searchParams.get('winner') ?? '').trim().slice(0, 120);
  const firstKey = normalizeBracketPlayerName(firstName);
  const secondKey = normalizeBracketPlayerName(secondName);
  if (!firstKey || !secondKey || firstKey === secondKey) {
    return NextResponse.json({ error: 'A valid player matchup is required.' }, { status: 400 });
  }
  const requestedWinnerKey = normalizeBracketPlayerName(requestedWinner);
  const hasRequestedWinner = requestedWinnerKey === firstKey || requestedWinnerKey === secondKey;
  const scorePerspectiveName = hasRequestedWinner ? requestedWinner : firstName;

  try {
    const tournament = await getTournament(key);
    if (!tournament) return NextResponse.json({ error: 'Tournament not found.' }, { status: 404 });
    const challongeId = getChallongeTournamentId(String(tournament.official_url ?? ''));
    const nameKey = String(tournament.name ?? '').toLocaleLowerCase('en').replace(/[^a-z0-9]/g, '');

    const roster = await sql`
      SELECT wtsl_player_id, name
      FROM wtsl_players
      WHERE tour=${String(tournament.tour)}
        AND lower(name)=ANY(${[firstName, secondName].map((name) => name.toLocaleLowerCase('en'))})
    `;
    const players = (roster as any[]).filter((player) => [firstKey, secondKey]
      .includes(normalizeBracketPlayerName(player.name)));
    const playerIds = new Map<string, string>();
    const ambiguousNames = new Set<string>();
    for (const player of players) {
      const playerKey = normalizeBracketPlayerName(player.name);
      if (ambiguousNames.has(playerKey)) continue;
      const existingId = playerIds.get(playerKey);
      if (existingId && existingId !== String(player.wtsl_player_id)) {
        playerIds.delete(playerKey);
        ambiguousNames.add(playerKey);
      } else {
        playerIds.set(playerKey, String(player.wtsl_player_id));
      }
    }
    const firstId = playerIds.get(firstKey);
    const secondId = playerIds.get(secondKey);
    let meetings: any[] = [];
    let uniqueMeetings: any[] = [];
    let tournamentMatch: any = null;
    let playerStats: any[] = [];

    if (firstId && secondId) {
      let eventMatches: any[] = [];
      [meetings, playerStats, eventMatches] = await Promise.all([
        sql`
        SELECT m.id, m.tournament_key, m.tournament_name, m.round_name, m.score, m.winner_id, m.played_at,
          m.stats, m.source_id, p1.name AS player_one_name, p2.name AS player_two_name
        FROM match_stats m
        LEFT JOIN wtsl_players p1
          ON p1.wtsl_player_id=m.player_one_id AND p1.tour=m.tour
        LEFT JOIN wtsl_players p2
          ON p2.wtsl_player_id=m.player_two_id AND p2.tour=m.tour
        WHERE m.tour=${String(tournament.tour)}
          AND (
            (m.player_one_id=${firstId} AND m.player_two_id=${secondId})
            OR (m.player_one_id=${secondId} AND m.player_two_id=${firstId})
          )
        ORDER BY CASE WHEN COALESCE(m.source_id,'') LIKE 'recent:%' THEN 0 ELSE 1 END,
          m.played_at DESC NULLS LAST
        LIMIT 100
        `,
        sql`
          SELECT player_id, matches, wins, losses, aces, winners, break_points_won, first_serve_pct
          FROM player_stats_summary
          WHERE tour=${String(tournament.tour)} AND player_id=ANY(${[firstId, secondId]})
        `,
        sql`
          SELECT m.id, m.tournament_key, m.tournament_name, m.round_name, m.score, m.winner_id,
            m.played_at, m.stats, m.source_id, m.player_one_id, m.player_two_id,
            p1.name AS player_one_name, p2.name AS player_two_name
          FROM match_stats m
          LEFT JOIN wtsl_players p1
            ON p1.wtsl_player_id=m.player_one_id AND p1.tour=m.tour
          LEFT JOIN wtsl_players p2
            ON p2.wtsl_player_id=m.player_two_id AND p2.tour=m.tour
          WHERE m.tour=${String(tournament.tour)}
            AND m.score IS NOT NULL
            AND (
              (m.player_one_id=${firstId} AND m.player_two_id=${secondId})
              OR (m.player_one_id=${secondId} AND m.player_two_id=${firstId})
            )
            AND (
              m.tournament_key=${challongeId ?? ''}
              OR lower(regexp_replace(COALESCE(m.tournament_name,''),'[^a-z0-9]','','g'))
                LIKE ${`${String(tournament.name ?? '').toLocaleLowerCase('en').replace(/[^a-z0-9]/g, '')}%`}
            )
            AND (
              ${tournament.start_date ?? null}::date IS NULL
              OR m.played_at IS NULL
              OR m.played_at::date BETWEEN ${tournament.start_date ?? null}::date - 3
                AND ${tournament.start_date ?? null}::date + 45
            )
          ORDER BY CASE WHEN COALESCE(m.source_id,'') LIKE 'recent:%' THEN 0 ELSE 1 END,
            m.played_at DESC NULLS LAST
          LIMIT 20
        `,
      ]);

      uniqueMeetings = dedupeEquivalentOfficialMeetings(meetings, firstName);
      const uniqueEventMatches = dedupeEquivalentOfficialMeetings(eventMatches, firstName);
      const roundKey = roundName.toLocaleLowerCase('en').replace(/[^a-z0-9]/g, '');
      const candidates = uniqueEventMatches.filter((match) => {
        const sameRound = !roundKey
          || String(match.round_name ?? '').toLocaleLowerCase('en').replace(/[^a-z0-9]/g, '') === roundKey;
        const scoreMatches = !requestedScore || (
          Boolean(match.score)
          && normalizeOfficialResultScore(
            orientOfficialScore(String(match.score), match.player_one_name, scorePerspectiveName),
          ) === normalizeOfficialResultScore(requestedScore)
        );
        return (requestedScore ? scoreMatches : sameRound && Boolean(match.score));
      });
      const distinctCandidates = candidates;
      if (distinctCandidates.length === 1) tournamentMatch = distinctCandidates[0];
      else if (!requestedScore && candidates.length === 0 && uniqueEventMatches.length === 1) {
        tournamentMatch = uniqueEventMatches[0];
      }

      if (!tournamentMatch && challongeId && requestedScore) {
        try {
          const officialRows = await fetchWTSLTournamentResults(challongeId);
          const matchingRows = officialRows.filter((row) => {
            const rowFirst = normalizeBracketPlayerName(row.player1Name);
            const rowSecond = normalizeBracketPlayerName(row.player2Name);
            const samePair = (rowFirst === firstKey && rowSecond === secondKey)
              || (rowFirst === secondKey && rowSecond === firstKey);
            return samePair
              && normalizeOfficialResultScore(
                orientOfficialScore(row.score, row.player1Name, scorePerspectiveName),
              ) === normalizeOfficialResultScore(requestedScore);
          });
          if (matchingRows.length === 1) {
            const row = matchingRows[0];
            tournamentMatch = {
              player_one_id: row.player1Id,
              player_two_id: row.player2Id,
              player_one_name: row.player1Name,
              player_two_name: row.player2Name,
              winner_id: row.player1Id,
              score: row.score,
              stats: {},
            };
          }
        } catch (error) {
          console.warn('[tournament-match-details] Official event result unavailable', {
            errorType: error instanceof Error ? error.name : 'UnknownError',
          });
        }
      }
    }

    const perspectiveForWinnerId = (winnerId: unknown, fallbackName: string) => {
      if (winnerId == null) return fallbackName;
      if (firstId && String(winnerId) === firstId) return firstName;
      if (secondId && String(winnerId) === secondId) return secondName;
      return fallbackName;
    };
    const wins = { first: 0, second: 0 };
    for (const match of uniqueMeetings) {
      if (match.winner_id == null) continue;
      if (String(match.winner_id) === firstId) wins.first += 1;
      if (String(match.winner_id) === secondId) wins.second += 1;
    }

    let odds: { first: number; second: number } | null = null;
    try {
      const openFixtures = await wtslCore.openFixtures();
      const fixture = openFixtures.find((candidate) => {
        const first = normalizeBracketPlayerName(candidate.first_name);
        const second = normalizeBracketPlayerName(candidate.second_name);
        const samePair = (first === firstKey && second === secondKey)
          || (first === secondKey && second === firstKey);
        const fixtureTournament = String(candidate.tournament ?? '')
          .toLocaleLowerCase('en')
          .replace(/[^a-z0-9]/g, '');
        return samePair && Boolean(fixtureTournament)
          && (fixtureTournament === nameKey || fixtureTournament.startsWith(nameKey));
      });
      if (fixture) {
        const first = Number(fixture.odds_one);
        const second = Number(fixture.odds_two);
        if (Number.isFinite(first) && first > 0 && Number.isFinite(second) && second > 0) {
          odds = normalizeBracketPlayerName(fixture.first_name) === firstKey
            ? { first, second }
            : { first: second, second: first };
        }
      }
    } catch (error) {
      console.warn('[tournament-match-details] Open odds unavailable', {
        errorType: error instanceof Error ? error.name : 'UnknownError',
      });
    }

    return NextResponse.json({
      firstName,
      secondName,
      characterPicks: { first: firstCharacter, second: secondCharacter },
      playerIds: { first: firstId ?? null, second: secondId ?? null },
      playerStats,
      headToHead: { ...wins, matches: wins.first + wins.second },
      meetings: uniqueMeetings.slice(0, 10).map((match) => ({
        tournament: match.tournament_name,
        round: match.round_name,
        score: match.score
          ? orientOfficialScore(
            match.score,
            match.player_one_name,
            perspectiveForWinnerId(match.winner_id, firstName),
          )
          : null,
        winnerName: String(match.winner_id) === firstId ? firstName
          : String(match.winner_id) === secondId ? secondName : null,
        playedAt: match.played_at,
      })),
      result: tournamentMatch ? {
        score: orientOfficialScore(
          tournamentMatch.score,
          tournamentMatch.player_one_name,
          hasRequestedWinner
            ? scorePerspectiveName
            : perspectiveForWinnerId(tournamentMatch.winner_id, firstName),
        ),
        winnerName: String(tournamentMatch.winner_id) === firstId ? firstName
          : String(tournamentMatch.winner_id) === secondId ? secondName : null,
        stats: (() => {
          const stats = tournamentMatch.stats;
          if (!stats || typeof stats !== 'object' || Array.isArray(stats)) return {};
          const values = stats as Record<string, unknown>;
          if (String(tournamentMatch.player_one_id) === firstId) return values;
          return { ...values, player1: values.player2, player2: values.player1 };
        })(),
      } : null,
      odds,
    }, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    console.error('[tournament-match-details] Could not load matchup details', {
      errorType: error instanceof Error ? error.name : 'UnknownError',
    });
    return NextResponse.json({ error: 'Match details could not be loaded.' }, { status: 500 });
  }
}
