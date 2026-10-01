import { sql } from './db';
import { fetchWTSLPlayer, fetchWTSLPlayerStatsTable, fetchWTSLAllResults, TOURS, DEFAULT_TOUR, type TourCode } from './wtsl';

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
 * A recent-result score is only a completed match (not "Scheduled"/"Walkover"/etc) when it looks
 * like a list of set scores, e.g. "6-2,6-2,6-2" (optionally with a tiebreak point count in
 * parens, e.g. "7-6(4)", which is stripped before parsing). Returns the parsed sets or null.
 */
export function normalizeMatchScore(score: string): string {
  return score
    .replace(/\b(?:ret(?:ired)?|walkover)\.?(?=\s|$)/gi, '')
    .replace(/\//g, '-')
    .replace(/[,;]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseSets(score: string): [number, number][] | null {
  // The Discord spreadsheet uses spaces and `/` (for example `6/2 6/1`), while
  // the public WTSL feed uses commas and `-`. Accept both representations.
  const sets = normalizeMatchScore(score).split(' ').filter(Boolean);
  if (!sets.length) return null;
  const parsed: [number, number][] = [];
  for (const set of sets) {
    const m = set.replace(/\([^)]*\)/g, '').trim().match(/^(\d+)\s*-\s*(\d+)$/);
    if (!m) return null;
    parsed.push([Number(m[1]), Number(m[2])]);
  }
  return parsed;
}

/**
 * Upserts one completed match into `match_stats` from a single player's "Recent Results" row.
 * The same match appears on both players' profile pages, so a deterministic `source_id` (sorted
 * player pair + tournament + round + date) de-duplicates it regardless of which profile is
 * scraped first; a second insert attempt for the same match is a no-op.
 */
async function recordMatchResult(tour: TourCode, playerId: string, r: { tournamentKey: string | null; tournamentName: string; round: string; opponentId: string | null; opponentName: string; date: string | null; score: string }): Promise<boolean> {
  if (!r.opponentId || !r.score) return false;
  const sets = parseSets(r.score);
  if (!sets) return false; // skip "Scheduled", "Walkover", retirements without a clean set score, etc.

  const setsWon = sets.filter(([a, b]) => a > b).length;
  const winnerId = setsWon * 2 > sets.length ? playerId : r.opponentId;
  const pair = [playerId, r.opponentId].sort();
  const sourceId = `recent:${tour}:${r.tournamentKey ?? 'x'}:${r.round}:${pair[0]}-${pair[1]}:${r.date ?? ''}`;

  // `DO UPDATE ... WHERE tournament_name IS NULL` (not `DO NOTHING`) lets an existing match row —
  // recorded before `tournament_name` existed — get backfilled by a later sync, without
  // disturbing anything else about it. `xmax = 0` is Postgres's standard way to tell an INSERT
  // from an UPDATE in a single RETURNING clause, so `matchesRecorded` still only counts matches
  // that are genuinely new, not ones that just got backfilled.
  const inserted = await sql`
    INSERT INTO match_stats(source_id,tour,tournament_key,tournament_name,round_name,player_one_id,player_two_id,score,winner_id,played_at)
    VALUES(${sourceId},${tour},${r.tournamentKey},${r.tournamentName},${r.round},${playerId},${r.opponentId},${r.score},${winnerId},${r.date})
    ON CONFLICT(source_id) DO UPDATE SET tournament_name=COALESCE(match_stats.tournament_name, EXCLUDED.tournament_name)
    RETURNING (xmax = 0) AS inserted
  `;
  return inserted[0]?.inserted === true;
}

/**
 * Syncs real career stats for a single tour: the per-tour averages table (one request) plus
 * each player's profile page (fetched with limited concurrency, for win/loss record, titles,
 * prize money, form and recent results) — upserted into `player_stats_summary` /
 * `player_recent_results` / `match_stats` so the existing leaderboard, the matches page and a
 * new player dashboard all show accurate data.
 */
export async function syncPlayerStats(tour: TourCode = DEFAULT_TOUR) {
  const players = await sql`SELECT wtsl_player_id, official_url FROM wtsl_players WHERE tour=${tour}`;
  if (!players.length) return { tour, seen: 0, upserted: 0 };

  let averages: Awaited<ReturnType<typeof fetchWTSLPlayerStatsTable>> = [];
  try { averages = await fetchWTSLPlayerStatsTable(tour); } catch { /* averages table is a bonus; profile data still syncs without it */ }
  const averagesById = new Map(averages.map((a) => [a.playerId, a]));

  let upserted = 0;
  let failed = 0;
  let matchesRecorded = 0;
  let lastError: string | undefined;
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
        if (await recordMatchResult(tour, playerId, r)) matchesRecorded++;
      }
      upserted++;
    } catch (e) {
      // A single player's profile failing to load (rate limit, temporary 500, etc) shouldn't abort
      // the whole sync — but the error is still worth surfacing (e.g. a missing DB column would
      // fail every single player silently otherwise, looking identical to a full success).
      failed++;
      lastError = e instanceof Error ? e.message : String(e);
    }
  });

  let clutchUpdated: number | undefined;
  try { clutchUpdated = (await computeClutchStats(tour)).playersUpdated; }
  catch (e) { lastError = lastError ?? (e instanceof Error ? e.message : String(e)); }

  let characterUsage: Awaited<ReturnType<typeof syncCharacterUsage>> | undefined;
  if (tour === 'TE4') {
    try { characterUsage = await syncCharacterUsage(); }
    catch (e) { lastError = lastError ?? (e instanceof Error ? e.message : String(e)); }
  }

  return { tour, seen: players.length, upserted, failed, matchesRecorded, lastError, clutchUpdated, characterUsage };
}

export async function syncPlayerStatsAllTours() {
  const results = [];
  for (const t of TOURS) {
    try { results.push(await syncPlayerStats(t.code)); }
    catch (e) { results.push({ tour: t.code, error: e instanceof Error ? e.message : 'Sync failed' }); }
  }
  return results;
}

/**
 * Replicates the Discord bot's clutch-stats math (sets, tiebreaks and deciding sets won/played)
 * entirely from matches already stored in `match_stats` — no extra scraping needed, and it
 * covers every tour since `match_stats` is fed from every player's recent-results page regardless
 * of tour. `player_one_id`'s side of `score` is always the side that was scraped first (see
 * `recordMatchResult`), so each row's sets are reliably oriented for both players.
 */
export async function computeClutchStats(tour: TourCode) {
  const rows = await sql`SELECT player_one_id, player_two_id, score FROM match_stats WHERE tour=${tour}`;
  type Agg = { setsWon: number; setsLost: number; tiebreaksWon: number; tiebreaksPlayed: number; decidingSetsWon: number; decidingSetsPlayed: number };
  const agg = new Map<string, Agg>();
  const bump = (id: string) => {
    if (!agg.has(id)) agg.set(id, { setsWon: 0, setsLost: 0, tiebreaksWon: 0, tiebreaksPlayed: 0, decidingSetsWon: 0, decidingSetsPlayed: 0 });
    return agg.get(id)!;
  };
  for (const row of rows as { player_one_id: string; player_two_id: string; score: string }[]) {
    const sets = parseSets(String(row.score ?? ''));
    if (!sets || sets.length < 2) continue;
    const a1 = bump(String(row.player_one_id));
    const a2 = bump(String(row.player_two_id));
    let priorP1 = 0, priorP2 = 0;
    sets.forEach(([first, second], idx) => {
      const isLast = idx === sets.length - 1;
      if (first > second) { a1.setsWon++; a2.setsLost++; }
      else if (second > first) { a2.setsWon++; a1.setsLost++; }
      // Tiebreak set: tennis scores a tiebreak set 7-6 (or 6-7) for the shortcut-scored game total.
      if ((first === 6 && second === 7) || (first === 7 && second === 6)) {
        a1.tiebreaksPlayed++; a2.tiebreaksPlayed++;
        if (first > second) a1.tiebreaksWon++; else a2.tiebreaksWon++;
      }
      // Deciding set: the match's final set, in a best-of that went the distance (3+ sets played)
      // with the prior sets tied — i.e. it was the set that actually decided the match.
      if (isLast && sets.length >= 3 && priorP1 === priorP2 && first !== second) {
        a1.decidingSetsPlayed++; a2.decidingSetsPlayed++;
        if (first > second) a1.decidingSetsWon++; else a2.decidingSetsWon++;
      }
      if (first > second) priorP1++; else if (second > first) priorP2++;
    });
  }
  let playersUpdated = 0;
  for (const [playerId, a] of agg) {
    await sql`
      UPDATE player_stats_summary SET
        sets_won=${a.setsWon}, sets_lost=${a.setsLost},
        tiebreaks_won=${a.tiebreaksWon}, tiebreaks_played=${a.tiebreaksPlayed},
        deciding_sets_won=${a.decidingSetsWon}, deciding_sets_played=${a.decidingSetsPlayed}
      WHERE player_id=${playerId} AND tour=${tour}
    `;
    playersUpdated++;
  }
  return { tour, matchesSeen: rows.length, playersUpdated };
}

/**
 * Favourite-character tracking, scraped from `all_results_fetch.php` — the only public WTSL page
 * that records which character each player used per match. That feed only ever contains ATP (TE4)
 * rows (see `fetchWTSLAllResults`), so this only ever touches tour='TE4' data; WTA/Doubles/Coop/
 * Created players keep favorite_character=NULL since there's no public source for that data.
 */
export async function syncCharacterUsage() {
  const rows = await fetchWTSLAllResults();
  const picks = new Map<string, Map<string, number>>(); // playerId -> character -> count
  const bump = (playerId: string, character: string) => {
    if (!picks.has(playerId)) picks.set(playerId, new Map());
    const m = picks.get(playerId)!;
    m.set(character, (m.get(character) ?? 0) + 1);
  };
  let matchesCounted = 0;
  for (const r of rows) {
    if (!parseSets(r.score)) continue; // only count completed matches, not Walkover/Coin Toss/Scheduled/etc
    matchesCounted++;
    if (r.player1Character) bump(r.player1Id, r.player1Character);
    if (r.player2Character) bump(r.player2Id, r.player2Character);
  }

  let charactersWritten = 0;
  let playersUpdated = 0;
  for (const [playerId, characters] of picks) {
    let topCharacter = '';
    let topPicks = 0;
    let total = 0;
    for (const [character, count] of characters) {
      total += count;
      if (count > topPicks) { topPicks = count; topCharacter = character; }
      await sql`
        INSERT INTO player_character_usage(player_id,tour,character,picks,updated_at)
        VALUES (${playerId},'TE4',${character},${count},NOW())
        ON CONFLICT (player_id,tour,character) DO UPDATE SET picks=EXCLUDED.picks, updated_at=NOW()
      `;
      charactersWritten++;
    }
    await sql`
      UPDATE player_stats_summary
      SET favorite_character=${topCharacter}, favorite_character_picks=${topPicks}, character_matches=${total}
      WHERE player_id=${playerId} AND tour='TE4'
    `;
    playersUpdated++;
  }
  return { tour: 'TE4' as const, rowsSeen: rows.length, matchesCounted, charactersWritten, playersUpdated };
}
