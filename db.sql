CREATE TABLE IF NOT EXISTS users (
 id BIGSERIAL PRIMARY KEY, discord_id TEXT UNIQUE NOT NULL, username TEXT NOT NULL, display_name TEXT NOT NULL,
 avatar_url TEXT, bio TEXT DEFAULT '', wtsl_player_url TEXT, is_admin BOOLEAN NOT NULL DEFAULT FALSE, is_moderator BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_active_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS categories (
 id BIGSERIAL PRIMARY KEY, name TEXT UNIQUE NOT NULL, slug TEXT UNIQUE NOT NULL, description TEXT DEFAULT '', position INT NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS topics (
 id BIGSERIAL PRIMARY KEY, category_id BIGINT REFERENCES categories(id) ON DELETE SET NULL, author_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
 title TEXT NOT NULL, slug TEXT NOT NULL, body TEXT NOT NULL, pinned BOOLEAN DEFAULT FALSE, locked BOOLEAN DEFAULT FALSE,
 moderation_status TEXT NOT NULL DEFAULT 'approved', moderation_reason TEXT, moderated_by BIGINT REFERENCES users(id) ON DELETE SET NULL, moderated_at TIMESTAMPTZ,
 views INT NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS topics_slug_idx ON topics(slug);
CREATE INDEX IF NOT EXISTS topics_moderation_status_idx ON topics(moderation_status,created_at);
CREATE TABLE IF NOT EXISTS replies (
 id BIGSERIAL PRIMARY KEY, topic_id BIGINT NOT NULL REFERENCES topics(id) ON DELETE CASCADE, author_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
 body TEXT NOT NULL, moderation_status TEXT NOT NULL DEFAULT 'approved', moderation_reason TEXT,
 moderated_by BIGINT REFERENCES users(id) ON DELETE SET NULL, moderated_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS replies_moderation_status_idx ON replies(moderation_status,created_at);
CREATE TABLE IF NOT EXISTS articles (
 id BIGSERIAL PRIMARY KEY, author_id BIGINT REFERENCES users(id) ON DELETE SET NULL, title TEXT NOT NULL, slug TEXT UNIQUE NOT NULL,
 excerpt TEXT DEFAULT '', body TEXT NOT NULL, cover_url TEXT, published BOOLEAN NOT NULL DEFAULT FALSE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS reactions (
 id BIGSERIAL PRIMARY KEY, user_id BIGINT REFERENCES users(id) ON DELETE CASCADE, topic_id BIGINT REFERENCES topics(id) ON DELETE CASCADE,
 reply_id BIGINT REFERENCES replies(id) ON DELETE CASCADE, emoji TEXT NOT NULL, UNIQUE(user_id,topic_id,reply_id,emoji)
);
INSERT INTO categories(name,slug,description,position) VALUES
('General WTSL','general','League news, community discussion and everything WTSL.',1),
('Match Talk','match-talk','Previews, results, tactics, rivalries and match discussion.',2),
('Tournaments','tournaments','Grand Slams, Masters, tour events and WTSL competitions.',3),
('TE4','te4','Tennis Elbow 4 gameplay, mods, settings and simulation talk.',4),
('WTSL History','history','Past champions, records, rivalries and memorable moments.',5),
('Off Court','off-court','Community chat that does not fit elsewhere.',6),
('Announcements','announcements','Official community and forum announcements.',7)
ON CONFLICT (slug) DO NOTHING;

-- Seed discussion threads for the two WTSL-affiliated community events. Safe to re-run.
INSERT INTO topics(category_id,title,slug,body,pinned)
SELECT c.id,'🏆 Mystery Cup 2026','mystery-cup-2026',
  E'The Mystery Cup is back for 2026!\n\n**Dates:** September 28 – October 11, 2026\n**Venue:** TBD\n\n[Visit the official Mystery Cup site ↗](https://www.wtslmysterycup.com)\n\nDiscuss predictions, format and anything else Mystery Cup here.',
  TRUE
FROM categories c WHERE c.slug='announcements'
ON CONFLICT (slug) DO NOTHING;

INSERT INTO topics(category_id,title,slug,body,pinned)
SELECT c.id,'🌍 WTSL World Cup 2026','wtsl-world-cup-2026',
  E'National pride. High-stakes competition. The WTSL World Cup returns in 2026 — represent your country and make your people proud.\n\n[Visit the official WTSL World Cup site ↗](https://www.wtslworldcup.fun)\n\nDiscuss squads, rivalries and predictions here.',
  TRUE
FROM categories c WHERE c.slug='announcements'
ON CONFLICT (slug) DO NOTHING;

-- Optional starter article. It remains unpublished until an admin creates/publishes content.

CREATE TABLE IF NOT EXISTS wtsl_players (
 id BIGSERIAL PRIMARY KEY,
 wtsl_player_id TEXT NOT NULL,
 tour TEXT NOT NULL DEFAULT 'TE4',
 name TEXT NOT NULL,
 avatar_url TEXT,
 flag_url TEXT,
 country TEXT,
 rank INT,
 tour_elo INT,
 elo_label TEXT,
 official_url TEXT NOT NULL,
 synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(wtsl_player_id,tour)
);

CREATE TABLE IF NOT EXISTS tournaments (
 id BIGSERIAL PRIMARY KEY,
 wtsl_tournament_key TEXT UNIQUE NOT NULL,
 tour TEXT NOT NULL DEFAULT 'TE4',
 name TEXT NOT NULL,
 location TEXT,
 country TEXT,
 category TEXT,
 draw_size INT,
 surface TEXT,
 start_date DATE,
 status TEXT NOT NULL DEFAULT 'upcoming',
 champion_player_id TEXT,
 official_url TEXT NOT NULL,
 discussion_topic_id BIGINT REFERENCES topics(id) ON DELETE SET NULL,
 last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS tournaments_status_idx ON tournaments(status);
CREATE INDEX IF NOT EXISTS tournaments_start_date_idx ON tournaments(start_date);
CREATE INDEX IF NOT EXISTS tournaments_tour_idx ON tournaments(tour);
CREATE INDEX IF NOT EXISTS wtsl_players_name_idx ON wtsl_players(name);
CREATE INDEX IF NOT EXISTS wtsl_players_tour_idx ON wtsl_players(tour);

-- Migration for existing databases created before multi-tour support was added
-- (ATP / WTA / Competitive Doubles / Coop / Created Characters). Safe to re-run.
DO $$ BEGIN
  ALTER TABLE wtsl_players ADD COLUMN IF NOT EXISTS tour TEXT NOT NULL DEFAULT 'TE4';
  ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS tour TEXT NOT NULL DEFAULT 'TE4';
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wtsl_players_wtsl_player_id_key') THEN
    ALTER TABLE wtsl_players DROP CONSTRAINT wtsl_players_wtsl_player_id_key;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wtsl_players_wtsl_player_id_tour_key') THEN
    ALTER TABLE wtsl_players ADD CONSTRAINT wtsl_players_wtsl_player_id_tour_key UNIQUE(wtsl_player_id,tour);
  END IF;
END $$;

-- WTSL betting / stats / dashboard layer, adapted from the WTSL Discord bot.
CREATE TABLE IF NOT EXISTS betting_accounts (
 id BIGSERIAL PRIMARY KEY, discord_id TEXT UNIQUE NOT NULL, balance NUMERIC(20,2) NOT NULL DEFAULT 1000.00,
 total_staked NUMERIC(20,2) NOT NULL DEFAULT 0, total_returned NUMERIC(20,2) NOT NULL DEFAULT 0,
 total_profit NUMERIC(20,2) NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS betting_fixtures (
 id BIGSERIAL PRIMARY KEY, tournament_key TEXT, fixture_key TEXT UNIQUE NOT NULL, tour TEXT NOT NULL DEFAULT 'atp',
 player_one_id TEXT NOT NULL, player_one_name TEXT NOT NULL, player_one_avatar TEXT, player_two_id TEXT NOT NULL, player_two_name TEXT NOT NULL,
 player_two_avatar TEXT, odds_one NUMERIC(10,3) NOT NULL, odds_two NUMERIC(10,3) NOT NULL, scheduled_at TIMESTAMPTZ,
 status TEXT NOT NULL DEFAULT 'open', winner_id TEXT, result_note TEXT, settled_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS betting_bets (
 id BIGSERIAL PRIMARY KEY, fixture_id BIGINT NOT NULL REFERENCES betting_fixtures(id) ON DELETE CASCADE, discord_id TEXT NOT NULL,
 selection_id TEXT NOT NULL, selection_name TEXT NOT NULL, odds NUMERIC(10,3) NOT NULL, stake NUMERIC(20,2) NOT NULL CHECK(stake>0), potential_return NUMERIC(20,2) NOT NULL,
 status TEXT NOT NULL DEFAULT 'open', return_amount NUMERIC(20,2) NOT NULL DEFAULT 0, placed_at TIMESTAMPTZ NOT NULL DEFAULT now(), settled_at TIMESTAMPTZ,
 UNIQUE(fixture_id,discord_id,selection_id)
);
CREATE TABLE IF NOT EXISTS betting_parlays (
 id BIGSERIAL PRIMARY KEY, discord_id TEXT NOT NULL, stake NUMERIC(20,2) NOT NULL CHECK(stake>0), combined_odds NUMERIC(20,6) NOT NULL,
 potential_return NUMERIC(20,2) NOT NULL, status TEXT NOT NULL DEFAULT 'open', return_amount NUMERIC(20,2) NOT NULL DEFAULT 0, placed_at TIMESTAMPTZ NOT NULL DEFAULT now(), settled_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS betting_parlay_legs (
 parlay_id BIGINT NOT NULL REFERENCES betting_parlays(id) ON DELETE CASCADE, fixture_id BIGINT NOT NULL REFERENCES betting_fixtures(id) ON DELETE CASCADE,
 selection_id TEXT NOT NULL, selection_name TEXT NOT NULL, odds NUMERIC(10,3) NOT NULL, PRIMARY KEY(parlay_id,fixture_id)
);
CREATE TABLE IF NOT EXISTS player_stats_summary (
 player_id TEXT NOT NULL, tour TEXT NOT NULL DEFAULT 'TE4', matches INT NOT NULL DEFAULT 0, wins INT NOT NULL DEFAULT 0, losses INT NOT NULL DEFAULT 0,
 aces NUMERIC(8,2) NOT NULL DEFAULT 0, winners NUMERIC(8,2) NOT NULL DEFAULT 0, break_points_won NUMERIC(6,2) NOT NULL DEFAULT 0, first_serve_pct NUMERIC(6,2) NOT NULL DEFAULT 0,
 PRIMARY KEY(player_id,tour)
);
CREATE TABLE IF NOT EXISTS match_stats (
 id BIGSERIAL PRIMARY KEY, source_id TEXT UNIQUE, tour TEXT NOT NULL DEFAULT 'TE4', tournament_key TEXT, tournament_name TEXT, round_name TEXT,
 player_one_id TEXT NOT NULL, player_two_id TEXT NOT NULL, score TEXT, winner_id TEXT, played_at TIMESTAMPTZ,
 stats JSONB NOT NULL DEFAULT '{}'::jsonb, source_message_id TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS character_profiles (
 character_key TEXT PRIMARY KEY, name TEXT NOT NULL, country TEXT, avatar_url TEXT, attributes JSONB NOT NULL DEFAULT '{}'::jsonb, source_note TEXT
);
CREATE TABLE IF NOT EXISTS player_insights (
 id BIGSERIAL PRIMARY KEY, player_id TEXT NOT NULL, metric TEXT NOT NULL, insight TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS betting_fixture_status_idx ON betting_fixtures(status,scheduled_at);
CREATE INDEX IF NOT EXISTS match_stats_player_date_idx ON match_stats(player_one_id,played_at DESC);
CREATE INDEX IF NOT EXISTS match_stats_tournament_idx ON match_stats(tournament_key,played_at DESC);

-- Community awards (hall of fame). Insert rows here to publish winners on /awards.
CREATE TABLE IF NOT EXISTS awards (
  id BIGSERIAL PRIMARY KEY, season TEXT NOT NULL, category TEXT NOT NULL, winner TEXT NOT NULL,
  runner_up TEXT, note TEXT, position INT NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Match of the Year / Upset of the Year have two players, not a winner + runner-up — player_two,
-- score and link_url hold that fixture's detail so the page can render it as a match, not a podium.
DO $$ BEGIN
  ALTER TABLE awards ADD COLUMN IF NOT EXISTS player_two TEXT;
  ALTER TABLE awards ADD COLUMN IF NOT EXISTS score TEXT;
  ALTER TABLE awards ADD COLUMN IF NOT EXISTS link_url TEXT;
END $$;
-- Historical award winners are immutable record, but a winner's name can still be corrected later
-- (renames, casing fixes) — the unique key is season+category only (one row per award per season)
-- so re-running this file with an updated name/note UPDATEs the existing row instead of either
-- duplicating it (old key included winner) or silently no-op'ing.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'awards_season_category_winner_idx') THEN
    DROP INDEX awards_season_category_winner_idx;
  END IF;
END $$;
-- Earlier reruns (back when the unique key included `winner`) could have left more than one row
-- per season+category with different winner text. Collapse those down to the newest row per
-- season+category first, or creating the season+category-only unique index below fails.
DELETE FROM awards a USING (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY season, category ORDER BY id DESC) AS rn FROM awards
) dup WHERE a.id = dup.id AND dup.rn > 1;
CREATE UNIQUE INDEX IF NOT EXISTS awards_season_category_idx ON awards(season, category);

-- Backfilled past WTSL (TE4 ATP) award seasons, 2022-2025. Names are stripped of Discord emoji
-- and "aka ..." nicknames so they match the plain handle on the live WTSL rankings page (e.g.
-- "Dani21 🛩 aka Halapeno" -> "Dani21", "im retired... for good (KINGBARBOZA)" -> "KINGBARBOZA",
-- "Nacho" -> "Ventriloquist").
INSERT INTO awards(season,category,winner,runner_up,note,player_two,score,link_url,position) VALUES
  ('2025','Player of the Year (Year-End No. 1)','Debuffy',NULL,NULL,NULL,NULL,NULL,0),
  ('2025','Fans Favourite Award','Debuffy',NULL,NULL,NULL,NULL,NULL,1),
  ('2025','Stefan Edberg Sportsmanship Award','fakefederer',NULL,NULL,NULL,NULL,NULL,2),
  ('2025','Most Improved Player','gifu',NULL,NULL,NULL,NULL,NULL,3),
  ('2025','Newcomer of the Year','Madferit',NULL,NULL,NULL,NULL,NULL,4),
  ('2025','Arthur Ashe Humanitarian Award','Squeaky',NULL,NULL,NULL,NULL,NULL,5),
  ('2025','Farmer of the Year','Unicah',NULL,NULL,NULL,NULL,NULL,6),
  ('2025','Comedian/Troll of the Year','jsilv1',NULL,NULL,NULL,NULL,NULL,7),
  ('2025','Trickiest Player','Dani21',NULL,NULL,NULL,NULL,NULL,8),
  ('2025','Best Dressed Player','Franky Franchicha',NULL,NULL,NULL,NULL,NULL,9),
  ('2025','Coach of the Year','Ventriloquist',NULL,NULL,NULL,NULL,NULL,10),
  ('2025','Upset of the Year','Squeaky',NULL,NULL,'KINGBARBOZA','6-3 6-4 1-6 6-3','https://www.youtube.com/watch?v=SEraP0OYHr0',11),
  ('2025','Match of the Year','Debuffy',NULL,'US Open Final','Dani21','3-6 7-5 4-6 6-4 6-4','https://www.youtube.com/watch?v=9WTg1nihlbY',12),

  ('2024','Player of the Year (Year-End No. 1)','Debuffy',NULL,NULL,NULL,NULL,NULL,0),
  ('2024','Fans Favourite Award','Mystery',NULL,NULL,NULL,NULL,NULL,1),
  ('2024','Stefan Edberg Sportsmanship Award','The_End',NULL,NULL,NULL,NULL,NULL,2),
  ('2024','Most Improved Player','qoodL',NULL,NULL,NULL,NULL,NULL,3),
  ('2024','Newcomer of the Year','JiJo',NULL,NULL,NULL,NULL,NULL,4),
  ('2024','Arthur Ashe Humanitarian Award','Squeaky',NULL,NULL,NULL,NULL,NULL,5),
  ('2024','Farmer of the Year','Poland',NULL,NULL,NULL,NULL,NULL,6),
  ('2024','Comedian/Troll of the Year','Unicah',NULL,NULL,NULL,NULL,NULL,7),
  ('2024','Trickiest Player','KINGBARBOZA','Dani21','Tie',NULL,NULL,NULL,8),
  ('2024','Match of the Year','Mystery',NULL,'Australian Open Final','Fractals','6-3 3-6 6-3 6-4',NULL,9),
  ('2024','Upset of the Year','Dani21',NULL,'Roland Garros SF','Fractals','4-6 7-5 6-2 7-5',NULL,10),

  ('2023','Fans Favourite Award','Mystery',NULL,NULL,NULL,NULL,NULL,1),
  ('2023','Stefan Edberg Sportsmanship Award','The_End',NULL,NULL,NULL,NULL,NULL,2),
  ('2023','Most Improved Player','Dani21',NULL,NULL,NULL,NULL,NULL,3),
  ('2023','Newcomer of the Year','Katy',NULL,NULL,NULL,NULL,NULL,4),
  ('2023','Arthur Ashe Humanitarian Award','Squeaky',NULL,NULL,NULL,NULL,NULL,5),
  ('2023','Farmer of the Year','Mohd',NULL,NULL,NULL,NULL,NULL,6),
  ('2023','Comedian/Troll of the Year','KINGBARBOZA',NULL,NULL,NULL,NULL,NULL,7),
  ('2023','Trickiest Player','KINGBARBOZA',NULL,NULL,NULL,NULL,NULL,8),
  ('2023','Match of the Year','Fractals',NULL,'US Open Final','Debuffy','7-5 4-6 2-6 6-4 6-2',NULL,9),
  ('2023','Upset of the Year','Dani21',NULL,'Shanghai SF','Fractals','6-3 6-4',NULL,10),

  ('2022','Fans Favourite Award','Mystery',NULL,NULL,NULL,NULL,NULL,1),
  ('2022','Stefan Edberg Sportsmanship Award','IsCotillion','Ptacek','Tie',NULL,NULL,NULL,2),
  ('2022','Most Improved Player','Fractals',NULL,NULL,NULL,NULL,NULL,3),
  ('2022','Newcomer of the Year','Debuffy',NULL,NULL,NULL,NULL,NULL,4),
  ('2022','Arthur Ashe Humanitarian Award','Squeaky',NULL,NULL,NULL,NULL,NULL,5),
  ('2022','Farmer of the Year','MaxiReturns',NULL,NULL,NULL,NULL,NULL,6),
  ('2022','Comedian/Troll of the Year','KINGBARBOZA',NULL,NULL,NULL,NULL,NULL,7),
  ('2022','Trickiest Player','KINGBARBOZA',NULL,NULL,NULL,NULL,NULL,8),
  ('2022','Worst Scheduler','Filipo',NULL,NULL,NULL,NULL,NULL,9),
  ('2022','Tournament of the Year','US Open',NULL,NULL,NULL,NULL,NULL,10)
ON CONFLICT (season,category) DO UPDATE SET
  winner=EXCLUDED.winner, runner_up=EXCLUDED.runner_up, note=EXCLUDED.note,
  player_two=EXCLUDED.player_two, score=EXCLUDED.score, link_url=EXCLUDED.link_url, position=EXCLUDED.position;


-- Awards nomination/voting system (admin gated: nominees must be added and voting opened before members can vote).
CREATE TABLE IF NOT EXISTS award_cycles (
  id BIGSERIAL PRIMARY KEY, season TEXT NOT NULL UNIQUE, voting_open BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS award_categories (
  id BIGSERIAL PRIMARY KEY, cycle_id BIGINT NOT NULL REFERENCES award_cycles(id) ON DELETE CASCADE,
  name TEXT NOT NULL, slug TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  allow_write_in BOOLEAN NOT NULL DEFAULT TRUE, position INT NOT NULL DEFAULT 0,
  UNIQUE(cycle_id,slug)
);
CREATE TABLE IF NOT EXISTS award_nominees (
  id BIGSERIAL PRIMARY KEY, category_id BIGINT NOT NULL REFERENCES award_categories(id) ON DELETE CASCADE,
  name TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', position INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- voter_key is the Discord id for on-site votes, or the imported identifier (handle/email) for Google Form rows;
-- the unique constraint stops a single voter from casting more than one vote per category per source.
CREATE TABLE IF NOT EXISTS award_votes (
  id BIGSERIAL PRIMARY KEY, category_id BIGINT NOT NULL REFERENCES award_categories(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'site', voter_key TEXT NOT NULL,
  nominee_id BIGINT REFERENCES award_nominees(id) ON DELETE SET NULL, write_in TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(category_id,source,voter_key)
);
CREATE INDEX IF NOT EXISTS award_categories_cycle_idx ON award_categories(cycle_id);
CREATE INDEX IF NOT EXISTS award_votes_category_idx ON award_votes(category_id);

-- Seed this season's award categories (voting stays closed until an admin opens it).
DO $$
DECLARE cyc_id BIGINT;
BEGIN
  INSERT INTO award_cycles(season,voting_open) VALUES ('2026', FALSE) ON CONFLICT(season) DO NOTHING;
  SELECT id INTO cyc_id FROM award_cycles WHERE season='2026';
  INSERT INTO award_categories(cycle_id,name,slug,position) VALUES
    (cyc_id,'Fans Favourite Award','fans-favourite',1),
    (cyc_id,'Stefan Edberg Sportsmanship Award','stefan-edberg-sportsmanship',2),
    (cyc_id,'Most Improved Player','most-improved-player',3),
    (cyc_id,'Newcomer of the Year','newcomer-of-the-year',4),
    (cyc_id,'Arthur Ashe Humanitarian Award','arthur-ashe-humanitarian',5),
    (cyc_id,'Farmer of the Year','farmer-of-the-year',6),
    (cyc_id,'Comedian/Troll of the Year','comedian-troll-of-the-year',7),
    (cyc_id,'Trickiest Player','trickiest-player',8),
    (cyc_id,'Best Dressed Player','best-dressed-player',9),
    (cyc_id,'Coach of the Year','coach-of-the-year',10),
    (cyc_id,'Upset of the Year','upset-of-the-year',11),
    (cyc_id,'Match of the Year','match-of-the-year',12)
  ON CONFLICT (cycle_id,slug) DO UPDATE SET name=EXCLUDED.name;
END $$;

-- Media/clips: members submit a link (YouTube/Twitch/Streamable/Discord) or upload a file to Vercel Blob.
CREATE TABLE IF NOT EXISTS media_clips (
  id BIGSERIAL PRIMARY KEY, submitted_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', url TEXT NOT NULL, tour TEXT,
  moderation_status TEXT NOT NULL DEFAULT 'approved', moderation_reason TEXT,
  private_blob_pathname TEXT, private_blob_content_type TEXT,
  moderated_by BIGINT REFERENCES users(id) ON DELETE SET NULL, moderated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS media_clips_created_idx ON media_clips(created_at DESC);
CREATE INDEX IF NOT EXISTS media_clips_moderation_status_idx ON media_clips(moderation_status,created_at);

CREATE TABLE IF NOT EXISTS community_notes (
  id BIGSERIAL PRIMARY KEY,
  topic_id BIGINT REFERENCES topics(id) ON DELETE CASCADE,
  reply_id BIGINT REFERENCES replies(id) ON DELETE CASCADE,
  author_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  moderation_status TEXT NOT NULL DEFAULT 'approved',
  moderation_reason TEXT,
  moderated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  moderated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT community_notes_one_target CHECK ((topic_id IS NOT NULL AND reply_id IS NULL) OR (topic_id IS NULL AND reply_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS community_notes_topic_author_idx ON community_notes(topic_id,author_id) WHERE topic_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS community_notes_reply_author_idx ON community_notes(reply_id,author_id) WHERE reply_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS community_notes_pending_idx ON community_notes(moderation_status,created_at);

CREATE TABLE IF NOT EXISTS community_note_ratings (
  id BIGSERIAL PRIMARY KEY,
  note_id BIGINT NOT NULL REFERENCES community_notes(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  helpful BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(note_id,user_id)
);

-- Migration: real career/YTD win-loss, titles, prize money, form and serve/rally averages,
-- scraped from the player's official WTSL profile + player statistics table. Safe to re-run.
DO $$ BEGIN
  ALTER TABLE player_stats_summary ADD COLUMN IF NOT EXISTS ytd_wins INT NOT NULL DEFAULT 0;
  ALTER TABLE player_stats_summary ADD COLUMN IF NOT EXISTS ytd_losses INT NOT NULL DEFAULT 0;
  ALTER TABLE player_stats_summary ADD COLUMN IF NOT EXISTS ytd_win_pct NUMERIC(6,2) NOT NULL DEFAULT 0;
  ALTER TABLE player_stats_summary ADD COLUMN IF NOT EXISTS titles_main INT NOT NULL DEFAULT 0;
  ALTER TABLE player_stats_summary ADD COLUMN IF NOT EXISTS finals_main INT NOT NULL DEFAULT 0;
  ALTER TABLE player_stats_summary ADD COLUMN IF NOT EXISTS prize_money NUMERIC(14,2) NOT NULL DEFAULT 0;
  ALTER TABLE player_stats_summary ADD COLUMN IF NOT EXISTS prize_currency TEXT;
  ALTER TABLE player_stats_summary ADD COLUMN IF NOT EXISTS form TEXT;
  ALTER TABLE player_stats_summary ADD COLUMN IF NOT EXISTS avg_double_faults NUMERIC(8,2) NOT NULL DEFAULT 0;
  ALTER TABLE player_stats_summary ADD COLUMN IF NOT EXISTS avg_first_serve_speed NUMERIC(8,2) NOT NULL DEFAULT 0;
  ALTER TABLE player_stats_summary ADD COLUMN IF NOT EXISTS avg_second_serve_speed NUMERIC(8,2) NOT NULL DEFAULT 0;
  ALTER TABLE player_stats_summary ADD COLUMN IF NOT EXISTS avg_net_points_pct NUMERIC(6,2) NOT NULL DEFAULT 0;
  ALTER TABLE player_stats_summary ADD COLUMN IF NOT EXISTS avg_forced_errors NUMERIC(8,2) NOT NULL DEFAULT 0;
  ALTER TABLE player_stats_summary ADD COLUMN IF NOT EXISTS avg_unforced_errors NUMERIC(8,2) NOT NULL DEFAULT 0;
  ALTER TABLE player_stats_summary ADD COLUMN IF NOT EXISTS avg_short_rally_pct NUMERIC(6,2) NOT NULL DEFAULT 0;
  ALTER TABLE player_stats_summary ADD COLUMN IF NOT EXISTS avg_medium_rally_pct NUMERIC(6,2) NOT NULL DEFAULT 0;
  ALTER TABLE player_stats_summary ADD COLUMN IF NOT EXISTS avg_long_rally_pct NUMERIC(6,2) NOT NULL DEFAULT 0;
  ALTER TABLE player_stats_summary ADD COLUMN IF NOT EXISTS avg_first_serve_won_pct NUMERIC(6,2) NOT NULL DEFAULT 0;
  ALTER TABLE player_stats_summary ADD COLUMN IF NOT EXISTS avg_second_serve_won_pct NUMERIC(6,2) NOT NULL DEFAULT 0;
  ALTER TABLE player_stats_summary ADD COLUMN IF NOT EXISTS avg_return_won_pct NUMERIC(6,2) NOT NULL DEFAULT 0;
  ALTER TABLE player_stats_summary ADD COLUMN IF NOT EXISTS avg_rally_length NUMERIC(8,2) NOT NULL DEFAULT 0;
  ALTER TABLE player_stats_summary ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
  -- These are per-match averages scraped from the stats table (e.g. "2.8" aces/match), not whole
  -- counts, so they must be decimal, not INT, or every sync fails to write with "invalid input
  -- syntax for type integer".
  ALTER TABLE player_stats_summary ALTER COLUMN aces TYPE NUMERIC(8,2);
  ALTER TABLE player_stats_summary ALTER COLUMN winners TYPE NUMERIC(8,2);
  ALTER TABLE player_stats_summary ALTER COLUMN break_points_won TYPE NUMERIC(6,2);
  -- Recent-results matches recorded the tournament's raw ID, not a name, so "Recent matches"
  -- had no human-readable tournament to show. Store the scraped tournament name directly
  -- alongside each match instead of relying on a join against `tournaments` (whose keys are a
  -- different generated format and don't match these raw IDs).
  ALTER TABLE match_stats ADD COLUMN IF NOT EXISTS tournament_name TEXT;
END $$;

-- Identity verification: a member claims "I am this WTSL player" and an admin
-- must approve it before the forum shows the account as the verified owner.
-- This is the only way a Discord account gets tied to a WTSL player profile,
-- so nobody can self-declare and impersonate another player.
CREATE TABLE IF NOT EXISTS player_claims (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wtsl_player_id TEXT NOT NULL,
  tour TEXT NOT NULL DEFAULT 'TE4',
  player_name TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  reviewed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  review_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS player_claims_status_idx ON player_claims(status);
CREATE INDEX IF NOT EXISTS player_claims_user_idx ON player_claims(user_id);
-- A player can only be verified to one account at a time.
CREATE UNIQUE INDEX IF NOT EXISTS player_claims_one_owner_idx ON player_claims(wtsl_player_id, tour) WHERE status = 'approved';

-- Default forum identity for accounts with multiple approved tour claims.
ALTER TABLE users ADD COLUMN IF NOT EXISTS default_player_claim_id BIGINT;
DO $$ BEGIN
  ALTER TABLE users ADD CONSTRAINT users_default_player_claim_id_fkey
    FOREIGN KEY (default_player_claim_id) REFERENCES player_claims(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
-- Existing accounts start with their earliest approved identity; members can change this in Profile.
UPDATE users u
SET default_player_claim_id = (
  SELECT c.id FROM player_claims c
  WHERE c.user_id = u.id AND c.status = 'approved'
  ORDER BY c.created_at ASC, c.id ASC LIMIT 1
)
WHERE u.default_player_claim_id IS NULL;

-- Identity verification: a member claims "this is my Challonge username" so the predictions
-- leaderboard (keyed by Challonge usernames from bracket picks, e.g. "Squeaky94") can show their
-- official WTSL forum identity/name instead of the raw Challonge handle. Same admin-approval
-- pattern as player_claims — not tour-scoped since one Challonge account covers all tours.
CREATE TABLE IF NOT EXISTS challonge_claims (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  challonge_username TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  reviewed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  review_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS challonge_claims_status_idx ON challonge_claims(status);
CREATE INDEX IF NOT EXISTS challonge_claims_user_idx ON challonge_claims(user_id);
-- A Challonge username can only be verified to one account at a time (case-insensitive).
CREATE UNIQUE INDEX IF NOT EXISTS challonge_claims_one_owner_idx ON challonge_claims(LOWER(challonge_username)) WHERE status = 'approved';

DO $$ BEGIN
  ALTER TABLE users ADD COLUMN IF NOT EXISTS verified_player_id TEXT;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS verified_player_tour TEXT;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS verified_player_name TEXT;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;
  ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS logo_url TEXT;
END $$;

-- Recent match results shown on a player's dashboard, refreshed (truncate + reinsert) each sync.
CREATE TABLE IF NOT EXISTS player_recent_results (
  id BIGSERIAL PRIMARY KEY, player_id TEXT NOT NULL, tour TEXT NOT NULL DEFAULT 'TE4',
  tournament_key TEXT, tournament_name TEXT NOT NULL, round_name TEXT NOT NULL,
  opponent_id TEXT, opponent_name TEXT NOT NULL, score TEXT NOT NULL, played_at DATE,
  position INT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS player_recent_results_player_idx ON player_recent_results(player_id,tour,position);

-- Auto-linked Match Talk threads: one row per match/fixture the first time someone clicks
-- "Discuss", so the title/body is generated from the match itself instead of asking the user
-- to come up with one. match_key is "match-<match_stats.id>" for completed results or
-- "fixture-<fixture_key>" for open/upcoming fixtures from the betting Core API.
CREATE TABLE IF NOT EXISTS match_threads (
  id BIGSERIAL PRIMARY KEY, match_key TEXT UNIQUE NOT NULL, topic_id BIGINT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  tour TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
DO $$ BEGIN
  ALTER TABLE match_threads ADD COLUMN IF NOT EXISTS tour TEXT;
END $$;

-- Presence ("online"/"away"/"busy"/"offline") shown beside member names. Online expires without
-- an activity heartbeat; away, busy, and offline remain manual choices.
DO $$ BEGIN
  ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'online';
  ALTER TABLE users ADD COLUMN IF NOT EXISTS status_note TEXT NOT NULL DEFAULT '';
  ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ;
END $$;

-- Clutch stats (sets/tiebreaks/deciding sets won & played), computed from the match history
-- already recorded in match_stats (covers every tour — no extra scraping needed), plus favourite-
-- character tracking. Character data is only published by WTSL for TE4 (ATP) via
-- all_results_fetch.php — the tour query parameter on that feed is ignored, so WTA/Doubles/Coop
-- character usage is not available from any public WTSL page and these columns stay 0/NULL there.
DO $$ BEGIN
  ALTER TABLE player_stats_summary ADD COLUMN IF NOT EXISTS sets_won INT NOT NULL DEFAULT 0;
  ALTER TABLE player_stats_summary ADD COLUMN IF NOT EXISTS sets_lost INT NOT NULL DEFAULT 0;
  ALTER TABLE player_stats_summary ADD COLUMN IF NOT EXISTS tiebreaks_won INT NOT NULL DEFAULT 0;
  ALTER TABLE player_stats_summary ADD COLUMN IF NOT EXISTS tiebreaks_played INT NOT NULL DEFAULT 0;
  ALTER TABLE player_stats_summary ADD COLUMN IF NOT EXISTS deciding_sets_won INT NOT NULL DEFAULT 0;
  ALTER TABLE player_stats_summary ADD COLUMN IF NOT EXISTS deciding_sets_played INT NOT NULL DEFAULT 0;
  ALTER TABLE player_stats_summary ADD COLUMN IF NOT EXISTS favorite_character TEXT;
  ALTER TABLE player_stats_summary ADD COLUMN IF NOT EXISTS favorite_character_picks INT NOT NULL DEFAULT 0;
  ALTER TABLE player_stats_summary ADD COLUMN IF NOT EXISTS character_matches INT NOT NULL DEFAULT 0;
END $$;

-- Per-character pick counts backing `favorite_character` above — TE4 (ATP) only, see note above.
CREATE TABLE IF NOT EXISTS player_character_usage (
  player_id TEXT NOT NULL, tour TEXT NOT NULL DEFAULT 'TE4', character TEXT NOT NULL,
  picks INT NOT NULL DEFAULT 0, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(player_id, tour, character)
);
CREATE INDEX IF NOT EXISTS player_character_usage_player_idx ON player_character_usage(player_id, tour);

-- One-time cleanup: tournaments were previously de-duplicated by a key derived from
-- name+start_date, which broke whenever a tournament's start date was rescheduled after signups
-- opened (the key changed mid-event, orphaning the original row and creating a second one for the
-- same tournament — e.g. Tokyo/Jinan/Hangzhou/Chengdu/Qian Daohu each showing twice). The key is
-- now the site's own stable tournament ID (see lib/wtsl.ts), so re-running this is safe/idempotent
-- going forward; this block only ever needs to remove the duplicates left behind by the old scheme.
DO $$
DECLARE dup RECORD;
BEGIN
  FOR dup IN
    SELECT id, discussion_topic_id FROM (
      SELECT id, discussion_topic_id,
        ROW_NUMBER() OVER (PARTITION BY tour, name ORDER BY last_synced_at DESC, id DESC) AS rn
      FROM tournaments
    ) ranked
    WHERE rn > 1
  LOOP
    IF dup.discussion_topic_id IS NOT NULL THEN
      DELETE FROM topics WHERE id = dup.discussion_topic_id AND NOT EXISTS (SELECT 1 FROM replies WHERE topic_id = dup.discussion_topic_id);
    END IF;
    DELETE FROM tournaments WHERE id = dup.id;
  END LOOP;
END $$;

-- Direct messages between forum members. A lightweight inbox (list + thread view, polling-based
-- refresh) rather than real-time chat infrastructure — conversation_key is the two user ids
-- sorted and joined ("12:45") so both participants' messages land in the same thread regardless
-- of who sent first.
CREATE TABLE IF NOT EXISTS direct_messages (
  id BIGSERIAL PRIMARY KEY,
  conversation_key TEXT NOT NULL,
  sender_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS direct_messages_conversation_idx ON direct_messages(conversation_key, created_at);
CREATE INDEX IF NOT EXISTS direct_messages_recipient_unread_idx ON direct_messages(recipient_id) WHERE read_at IS NULL;

-- Versioned screenshot workbook rows. A complete snapshot is switched into view atomically.
CREATE TABLE IF NOT EXISTS screenshot_record_sync_state (
  tour TEXT PRIMARY KEY,
  active_sync_id TEXT NOT NULL,
  record_count INTEGER NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS screenshot_match_records (
  tour TEXT NOT NULL,
  sync_id TEXT NOT NULL,
  record_id TEXT NOT NULL,
  source_row INTEGER NOT NULL,
  player_name TEXT NOT NULL,
  opponent_name TEXT NOT NULL,
  tournament_name TEXT NOT NULL DEFAULT '',
  date_label TEXT NOT NULL DEFAULT '',
  played_on DATE,
  score TEXT NOT NULL,
  review_status TEXT NOT NULL DEFAULT '',
  record_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tour, sync_id, record_id)
);
CREATE INDEX IF NOT EXISTS screenshot_records_player_idx ON screenshot_match_records(tour, sync_id, LOWER(player_name));
CREATE INDEX IF NOT EXISTS screenshot_records_opponent_idx ON screenshot_match_records(tour, sync_id, LOWER(opponent_name));
CREATE INDEX IF NOT EXISTS screenshot_records_date_idx ON screenshot_match_records(tour, sync_id, played_on DESC);
CREATE INDEX IF NOT EXISTS screenshot_records_tournament_idx ON screenshot_match_records(tour, sync_id, tournament_name);

