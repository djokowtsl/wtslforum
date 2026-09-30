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

-- Optional starter article. It remains unpublished until an admin creates/publishes content.

CREATE TABLE IF NOT EXISTS wtsl_players (
 id BIGSERIAL PRIMARY KEY,
 wtsl_player_id TEXT UNIQUE NOT NULL,
 name TEXT NOT NULL,
 avatar_url TEXT,
 flag_url TEXT,
 country TEXT,
 rank INT,
 tour_elo INT,
 elo_label TEXT,
 official_url TEXT NOT NULL,
 synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tournaments (
 id BIGSERIAL PRIMARY KEY,
 wtsl_tournament_key TEXT UNIQUE NOT NULL,
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
CREATE INDEX IF NOT EXISTS wtsl_players_name_idx ON wtsl_players(name);

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
