CREATE TABLE IF NOT EXISTS users (
 id BIGSERIAL PRIMARY KEY, discord_id TEXT UNIQUE NOT NULL, username TEXT NOT NULL, display_name TEXT NOT NULL,
 avatar_url TEXT, bio TEXT DEFAULT '', wtsl_player_url TEXT, is_admin BOOLEAN NOT NULL DEFAULT FALSE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS categories (
 id BIGSERIAL PRIMARY KEY, name TEXT UNIQUE NOT NULL, slug TEXT UNIQUE NOT NULL, description TEXT DEFAULT '', position INT NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS topics (
 id BIGSERIAL PRIMARY KEY, category_id BIGINT REFERENCES categories(id) ON DELETE SET NULL, author_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
 title TEXT NOT NULL, slug TEXT NOT NULL, body TEXT NOT NULL, pinned BOOLEAN DEFAULT FALSE, locked BOOLEAN DEFAULT FALSE,
 views INT NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS topics_slug_idx ON topics(slug);
CREATE TABLE IF NOT EXISTS replies (
 id BIGSERIAL PRIMARY KEY, topic_id BIGINT NOT NULL REFERENCES topics(id) ON DELETE CASCADE, author_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
 body TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
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
 aces INT NOT NULL DEFAULT 0, winners INT NOT NULL DEFAULT 0, break_points_won INT NOT NULL DEFAULT 0, first_serve_pct NUMERIC(6,2) NOT NULL DEFAULT 0,
 PRIMARY KEY(player_id,tour)
);
CREATE TABLE IF NOT EXISTS match_stats (
 id BIGSERIAL PRIMARY KEY, source_id TEXT UNIQUE, tour TEXT NOT NULL DEFAULT 'TE4', tournament_key TEXT, round_name TEXT,
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
    (cyc_id,'🦑 Farmer of the Year','farmer-of-the-year',6),
    (cyc_id,'Comedian/Troll of the Year','comedian-troll-of-the-year',7),
    (cyc_id,'Trickiest Player','trickiest-player',8),
    (cyc_id,'Best Dressed Player','best-dressed-player',9),
    (cyc_id,'Coach of the Year','coach-of-the-year',10),
    (cyc_id,'Upset of the Year','upset-of-the-year',11),
    (cyc_id,'Match of the Year','match-of-the-year',12)
  ON CONFLICT (cycle_id,slug) DO NOTHING;
END $$;

-- Media/clips: members submit a link (YouTube/Twitch/Streamable/Discord) or upload a file to Vercel Blob.
CREATE TABLE IF NOT EXISTS media_clips (
  id BIGSERIAL PRIMARY KEY, submitted_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', url TEXT NOT NULL, tour TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS media_clips_created_idx ON media_clips(created_at DESC);

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
