import {sql} from './db';

// Small-sample stats (e.g. a 3-0 player at #1 by win %) are misleading on a ranked leaderboard,
// so anyone under this many recorded matches is excluded entirely rather than just ranked low.
// Exported so the page can display the same number in its "why isn't X here" note.
export const LEADERBOARD_MIN_MATCHES = 20;

export async function leaderboard(tour='TE4', metric='wins'){
  const order = ['wins','win_pct','aces','winners','break_points','first_serve_pct','elo'].includes(metric)
    ? metric
    : 'wins';

  // `matches`/`wins`/`losses` are computed straight from `match_stats` (not `player_stats_summary`,
  // which only ever holds the last ~10 results the official WTSL site exposes per player) so the
  // deeper history fed in via the bot's spreadsheet import is actually reflected here.
  return sql`
    WITH match_counts AS (
      SELECT player_id, COUNT(*)::int matches, SUM(CASE WHEN winner_id=player_id THEN 1 ELSE 0 END)::int wins
      FROM (
        SELECT player_one_id player_id, winner_id FROM match_stats WHERE tour=${tour}
        UNION ALL
        SELECT player_two_id player_id, winner_id FROM match_stats WHERE tour=${tour}
      ) sides
      GROUP BY player_id
    )
    SELECT p.*,
      COALESCE(mc.matches,0) matches,
      COALESCE(mc.wins,0) wins,
      GREATEST(COALESCE(mc.matches,0)-COALESCE(mc.wins,0),0) losses,
      COALESCE(s.aces,0) aces,
      COALESCE(s.winners,0) winners,
      COALESCE(s.break_points_won,0) break_points_won,
      COALESCE(s.first_serve_pct,0) first_serve_pct,
      CASE WHEN COALESCE(mc.matches,0)>0
        THEN ROUND(100.0*mc.wins/mc.matches,1)
        ELSE 0
      END win_pct
    FROM wtsl_players p
    LEFT JOIN match_counts mc ON mc.player_id=p.wtsl_player_id
    LEFT JOIN player_stats_summary s
      ON s.player_id=p.wtsl_player_id
      AND s.tour=${tour}
    WHERE p.tour=${tour} AND COALESCE(mc.matches,0) >= ${LEADERBOARD_MIN_MATCHES}
    ORDER BY
      CASE
        WHEN ${order} = 'win_pct' THEN
          CASE WHEN COALESCE(mc.matches,0)>0
            THEN 100.0*mc.wins/mc.matches
            ELSE 0
          END
        WHEN ${order} = 'aces' THEN COALESCE(s.aces,0)
        WHEN ${order} = 'winners' THEN COALESCE(s.winners,0)
        WHEN ${order} = 'break_points' THEN COALESCE(s.break_points_won,0)
        WHEN ${order} = 'first_serve_pct' THEN COALESCE(s.first_serve_pct,0)
        WHEN ${order} = 'elo' THEN COALESCE(p.tour_elo,0)
        ELSE COALESCE(mc.wins,0)
      END DESC NULLS LAST,
      p.name ASC
  `;
}

// Every player for the tour, A-Z, with no limit — the Statistics page lists the full roster
// (scrollable) rather than a top-N cut, which is reserved for the stat-ranked /leaderboard page.
export async function allPlayerStats(tour='TE4'){
  return sql`
    WITH match_counts AS (
      SELECT player_id, COUNT(*)::int matches, SUM(CASE WHEN winner_id=player_id THEN 1 ELSE 0 END)::int wins
      FROM (
        SELECT player_one_id player_id, winner_id FROM match_stats WHERE tour=${tour}
        UNION ALL
        SELECT player_two_id player_id, winner_id FROM match_stats WHERE tour=${tour}
      ) sides
      GROUP BY player_id
    )
    SELECT p.*,
      COALESCE(mc.matches,0) matches,
      COALESCE(mc.wins,0) wins,
      GREATEST(COALESCE(mc.matches,0)-COALESCE(mc.wins,0),0) losses,
      COALESCE(s.aces,0) aces,
      COALESCE(s.winners,0) winners,
      COALESCE(s.break_points_won,0) break_points_won,
      COALESCE(s.first_serve_pct,0) first_serve_pct,
      CASE WHEN COALESCE(mc.matches,0)>0
        THEN ROUND(100.0*mc.wins/mc.matches,1)
        ELSE 0
      END win_pct
    FROM wtsl_players p
    LEFT JOIN match_counts mc ON mc.player_id=p.wtsl_player_id
    LEFT JOIN player_stats_summary s
      ON s.player_id=p.wtsl_player_id
      AND s.tour=${tour}
    WHERE p.tour=${tour}
    ORDER BY p.name ASC
  `;
}

export async function playerStats(playerId:string){
  return sql`
    SELECT p.*, s.*
    FROM wtsl_players p
    LEFT JOIN player_stats_summary s
      ON s.player_id=p.wtsl_player_id
    WHERE p.wtsl_player_id=${playerId}
    ORDER BY s.tour
  `;
}

export async function playersByNames(tour: string, names: string[]) {
  if (names.length === 0) return [];
  return sql`
    SELECT wtsl_player_id, name, avatar_url, flag_url
    FROM wtsl_players
    WHERE tour=${tour} AND lower(name) = ANY(${names.map((n) => n.toLowerCase())})
  `;
}

// Powers the player-search autocomplete on the verification form — nobody can be expected to
// know their own numeric WTSL player ID, so they find themselves by name instead.
export async function searchPlayers(tour: string, query: string, limit = 8) {
  const q = query.trim();
  if (q.length < 2) return [];
  return sql`
    SELECT wtsl_player_id, name, avatar_url, country
    FROM wtsl_players
    WHERE tour=${tour} AND name ILIKE ${'%' + q + '%'}
    ORDER BY name ASC
    LIMIT ${limit}
  `;
}

export async function recentMatches(limit=20, tour='TE4'){
  return sql`
    SELECT m.*,
      p1.name player_one_name,
      p1.avatar_url player_one_avatar,
      p1.flag_url player_one_flag,
      p2.name player_two_name,
      p2.avatar_url player_two_avatar,
      p2.flag_url player_two_flag
    FROM match_stats m
    LEFT JOIN wtsl_players p1 ON p1.wtsl_player_id=m.player_one_id AND p1.tour=m.tour
    LEFT JOIN wtsl_players p2 ON p2.wtsl_player_id=m.player_two_id AND p2.tour=m.tour
    WHERE m.tour=${tour} AND m.played_at IS NOT NULL
    ORDER BY m.played_at DESC
    LIMIT ${limit}
  `;
}

/**
 * The betting bot's "open fixtures" list can go stale — a fixture stays marked open there even
 * after the match has actually been played, because closing it depends on the bot's own
 * settlement job rather than anything the forum controls. We already have the real, synced
 * results in `match_stats`, so cross-check: any pairing that has a completed match recorded in
 * the last few weeks is treated as already played and filtered out of "open fixtures" here.
 */
export async function recentlyCompletedPairs(tour: string, days = 21): Promise<Set<string>> {
  const rows = await sql`
    SELECT player_one_id, player_two_id
    FROM match_stats
    WHERE tour=${tour} AND played_at IS NOT NULL AND played_at >= NOW() - (${days} || ' days')::interval
  `;
  return new Set(rows.map((r: any) => [String(r.player_one_id), String(r.player_two_id)].sort().join('|')));
}
