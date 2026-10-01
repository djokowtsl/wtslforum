import {sql} from './db';

// Small-sample stats (e.g. a 3-0 player at #1 by win %) are misleading on a ranked leaderboard,
// so anyone under this many recorded matches is excluded entirely rather than just ranked low.
// Exported so the page can display the same number in its "why isn't X here" note.
export const LEADERBOARD_MIN_MATCHES = 20;

export async function leaderboard(tour='TE4', metric='wins'){
  const order = ['wins','win_pct','aces','winners','break_points','first_serve_pct','elo'].includes(metric)
    ? metric
    : 'wins';

  return sql`
    SELECT p.*,
      COALESCE(s.matches,0) matches,
      COALESCE(s.wins,0) wins,
      COALESCE(s.losses,0) losses,
      COALESCE(s.aces,0) aces,
      COALESCE(s.winners,0) winners,
      COALESCE(s.break_points_won,0) break_points_won,
      COALESCE(s.first_serve_pct,0) first_serve_pct,
      CASE WHEN COALESCE(s.matches,0)>0
        THEN ROUND(100.0*s.wins/s.matches,1)
        ELSE 0
      END win_pct
    FROM wtsl_players p
    LEFT JOIN player_stats_summary s
      ON s.player_id=p.wtsl_player_id
      AND s.tour=${tour}
    WHERE p.tour=${tour} AND COALESCE(s.matches,0) >= ${LEADERBOARD_MIN_MATCHES}
    ORDER BY
      CASE
        WHEN ${order} = 'win_pct' THEN
          CASE WHEN COALESCE(s.matches,0)>0
            THEN 100.0*s.wins/s.matches
            ELSE 0
          END
        WHEN ${order} = 'aces' THEN COALESCE(s.aces,0)
        WHEN ${order} = 'winners' THEN COALESCE(s.winners,0)
        WHEN ${order} = 'break_points' THEN COALESCE(s.break_points_won,0)
        WHEN ${order} = 'first_serve_pct' THEN COALESCE(s.first_serve_pct,0)
        WHEN ${order} = 'elo' THEN COALESCE(p.tour_elo,0)
        ELSE COALESCE(s.wins,0)
      END DESC NULLS LAST,
      p.name ASC
  `;
}

// Every player for the tour, A-Z, with no limit — the Statistics page lists the full roster
// (scrollable) rather than a top-N cut, which is reserved for the stat-ranked /leaderboard page.
export async function allPlayerStats(tour='TE4'){
  return sql`
    SELECT p.*,
      COALESCE(s.matches,0) matches,
      COALESCE(s.wins,0) wins,
      COALESCE(s.losses,0) losses,
      COALESCE(s.aces,0) aces,
      COALESCE(s.winners,0) winners,
      COALESCE(s.break_points_won,0) break_points_won,
      COALESCE(s.first_serve_pct,0) first_serve_pct,
      CASE WHEN COALESCE(s.matches,0)>0
        THEN ROUND(100.0*s.wins/s.matches,1)
        ELSE 0
      END win_pct
    FROM wtsl_players p
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
