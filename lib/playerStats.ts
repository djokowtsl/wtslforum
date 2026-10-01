import { sql } from './db';
import { fetchWTSLPlayer, fetchWTSLPlayerStatsTable, TOURS, DEFAULT_TOUR, type TourCode } from './wtsl';

/**
 * Runs `worker` across `items` with at most `limit` in flight at once — a single player's
 * profile page failing or being slow doesn't block the rest, and parallelizing keeps a whole
 * tour's worth of profile scraping comfortably inside Vercel's per-request time limit.
 */
async function mapLimit<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  let next = 0;
  async function runner() {
    while (next < items.length) {
      const item = items[next++];
      await worker(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner));
}

/**
 * Syncs real career stats for a single tour: the per-tour averages table (one request) plus
 * each player's profile page (fetched with limited concurrency, for win/loss record, titles,
 * prize money, form and recent results) — upserted into `player_stats_summary` /
 * `player_recent_results` so the existing leaderboard and a new player dashboard both show
 * accurate data.
 */
export async function syncPlayerStats(tour: TourCode = DEFAULT_TOUR) {
  const players = await sql`SELECT wtsl_player_id, official_url FROM wtsl_players WHERE tour=${tour}`;
  if (!players.length) return { tour, seen: 0, upserted: 0 };

  let averages: Awaited<ReturnType<typeof fetchWTSLPlayerStatsTable>> = [];
  try { averages = await fetchWTSLPlayerStatsTable(tour); } catch { /* averages table is a bonus; profile data still syncs without it */ }
  const averagesById = new Map(averages.map((a) => [a.playerId, a]));

  let upserted = 0;
  await mapLimit(players, 8, async (row) => {
    const playerId = String(row.wtsl_player_id);
    const url = row.official_url || `https://www.playwtsl.com/TE4/pages/player_page.php?player=${playerId}`;
    try {
      const profile = await fetchWTSLPlayer(url);
      const avg = averagesById.get(playerId);
      await sql`
        INSERT INTO player_stats_summary(
          player_id,tour,matches,wins,losses,aces,winners,break_points_won,first_serve_pct,
          ytd_wins,ytd_losses,ytd_win_pct,titles_main,finals_main,prize_money,prize_currency,form,
          avg_double_faults,avg_first_serve_speed,avg_second_serve_speed,avg_net_points_pct,avg_forced_errors,
          avg_unforced_errors,avg_short_rally_pct,avg_medium_rally_pct,avg_long_rally_pct,
          avg_first_serve_won_pct,avg_second_serve_won_pct,avg_return_won_pct,avg_rally_length,updated_at
        ) VALUES (
          ${playerId},${tour},${(profile.careerWins ?? 0) + (profile.careerLosses ?? 0)},${profile.careerWins ?? 0},${profile.careerLosses ?? 0},
          ${avg?.avgAces ?? 0},${avg?.avgWinners ?? 0},${avg?.avgBpConversionPct ?? 0},${avg?.firstServePct ?? 0},
          ${profile.ytdWins ?? 0},${profile.ytdLosses ?? 0},${profile.ytdWinPct ?? 0},${profile.titlesMain ?? 0},${profile.finalsMain ?? 0},
          ${profile.prizeMoney ?? 0},${profile.prizeCurrency},${profile.form},
          ${avg?.avgDoubleFaults ?? 0},${avg?.avgFirstServeSpeed ?? 0},${avg?.avgSecondServeSpeed ?? 0},${avg?.avgNetPointsPct ?? 0},${avg?.avgForcedErrors ?? 0},
          ${avg?.avgUnforcedErrors ?? 0},${avg?.avgShortRalliesPct ?? 0},${avg?.avgMediumRalliesPct ?? 0},${avg?.avgLongRalliesPct ?? 0},
          ${avg?.avgFirstServeWonPct ?? 0},${avg?.avgSecondServeWonPct ?? 0},${avg?.avgReturnWonPct ?? 0},${avg?.avgRallyLength ?? 0},NOW()
        )
        ON CONFLICT(player_id,tour) DO UPDATE SET
          matches=EXCLUDED.matches,wins=EXCLUDED.wins,losses=EXCLUDED.losses,aces=EXCLUDED.aces,winners=EXCLUDED.winners,
          break_points_won=EXCLUDED.break_points_won,first_serve_pct=EXCLUDED.first_serve_pct,
          ytd_wins=EXCLUDED.ytd_wins,ytd_losses=EXCLUDED.ytd_losses,ytd_win_pct=EXCLUDED.ytd_win_pct,
          titles_main=EXCLUDED.titles_main,finals_main=EXCLUDED.finals_main,prize_money=EXCLUDED.prize_money,
          prize_currency=EXCLUDED.prize_currency,form=EXCLUDED.form,
          avg_double_faults=EXCLUDED.avg_double_faults,avg_first_serve_speed=EXCLUDED.avg_first_serve_speed,
          avg_second_serve_speed=EXCLUDED.avg_second_serve_speed,avg_net_points_pct=EXCLUDED.avg_net_points_pct,
          avg_forced_errors=EXCLUDED.avg_forced_errors,avg_unforced_errors=EXCLUDED.avg_unforced_errors,
          avg_short_rally_pct=EXCLUDED.avg_short_rally_pct,avg_medium_rally_pct=EXCLUDED.avg_medium_rally_pct,
          avg_long_rally_pct=EXCLUDED.avg_long_rally_pct,avg_first_serve_won_pct=EXCLUDED.avg_first_serve_won_pct,
          avg_second_serve_won_pct=EXCLUDED.avg_second_serve_won_pct,avg_return_won_pct=EXCLUDED.avg_return_won_pct,
          avg_rally_length=EXCLUDED.avg_rally_length,updated_at=NOW()
      `;

      await sql`DELETE FROM player_recent_results WHERE player_id=${playerId} AND tour=${tour}`;
      const recent = profile.recentResults.slice(0, 10);
      for (let i = 0; i < recent.length; i++) {
        const r = recent[i];
        await sql`INSERT INTO player_recent_results(player_id,tour,tournament_key,tournament_name,round_name,opponent_id,opponent_name,score,played_at,position) VALUES(${playerId},${tour},${r.tournamentKey},${r.tournamentName},${r.round},${r.opponentId},${r.opponentName},${r.score},${r.date},${i})`;
      }
      upserted++;
    } catch {
      // A single player's profile failing to load (rate limit, temporary 500, etc) shouldn't abort the whole sync.
    }
  });
  return { tour, seen: players.length, upserted };
}

export async function syncPlayerStatsAllTours() {
  const results = [];
  for (const t of TOURS) {
    try { results.push(await syncPlayerStats(t.code)); }
    catch (e) { results.push({ tour: t.code, error: e instanceof Error ? e.message : 'Sync failed' }); }
  }
  return results;
}
