-- Soccer League Web — PostgreSQL schema (v2: economy, contracts, auction, youth)
-- Applied automatically on boot by db.js if not already present. Uses
-- IF NOT EXISTS / ADD COLUMN IF NOT EXISTS throughout so it is safe to run
-- against an existing v1 database as well as a brand new one.

CREATE TABLE IF NOT EXISTS schema_meta (
  key   TEXT PRIMARY KEY,
  value JSONB
);

CREATE TABLE IF NOT EXISTS kv_store (
  store_key   VARCHAR(64) PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'viewer', -- admin | manager | viewer
  team_id       INTEGER,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stages (
  id                SERIAL PRIMARY KEY,
  name              TEXT NOT NULL,
  tier_order        INTEGER NOT NULL,        -- 1 = top stage, 2 = middle, 3 = bottom
  season            INTEGER NOT NULL DEFAULT 1,
  promotion_spots   INTEGER NOT NULL DEFAULT 2,
  relegation_spots  INTEGER NOT NULL DEFAULT 2
);

CREATE TABLE IF NOT EXISTS coaches (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  specialty     TEXT NOT NULL DEFAULT 'Tactical',
  rating        INTEGER NOT NULL DEFAULT 60,   -- 40-100, boosts development/match strength slightly
  wage          BIGINT NOT NULL DEFAULT 5000,
  team_id       INTEGER
);

CREATE TABLE IF NOT EXISTS teams (
  id              SERIAL PRIMARY KEY,
  stage_id        INTEGER REFERENCES stages(id) ON DELETE SET NULL,
  name            TEXT NOT NULL,
  short_name      TEXT,
  color           TEXT DEFAULT '#2FBF71',
  stadium_name    TEXT,
  formation       TEXT DEFAULT '4-3-3',
  mentality       TEXT DEFAULT 'Balanced',
  lineup_ids      INTEGER[] DEFAULT '{}',
  bench_ids       INTEGER[] DEFAULT '{}',
  wins            INTEGER DEFAULT 0,
  draws           INTEGER DEFAULT 0,
  losses          INTEGER DEFAULT 0,
  points          INTEGER DEFAULT 0,
  goals_for       INTEGER DEFAULT 0,
  goals_against   INTEGER DEFAULT 0,
  form            TEXT[] DEFAULT '{}',
  is_claimable    BOOLEAN DEFAULT true,
  budget          BIGINT NOT NULL DEFAULT 0,
  youth_level     INTEGER NOT NULL DEFAULT 1,     -- 1-5, upgradeable, raises youth-intake quality/quantity
  medical_level   INTEGER NOT NULL DEFAULT 1,     -- 1-5, upgradeable, speeds up injury recovery (up to 2x at level 5)
  coach_id        INTEGER REFERENCES coaches(id) ON DELETE SET NULL,
  youth_coach_name   TEXT,             -- named youth-academy coach (flavor text, not a real person)
  medical_staff_name TEXT,             -- named head physio (flavor text, not a real person)
  sponsor_name    TEXT,
  sponsor_value   BIGINT NOT NULL DEFAULT 0,      -- paid out once per season while active
  sponsor_seasons_left INTEGER NOT NULL DEFAULT 0
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'coaches_team_fk') THEN
    ALTER TABLE coaches ADD CONSTRAINT coaches_team_fk FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS players (
  id                    SERIAL PRIMARY KEY,
  team_id               INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  name                  TEXT NOT NULL,
  age                   INTEGER NOT NULL,
  position              TEXT NOT NULL,
  secondary_position    TEXT,
  nationality           TEXT,
  squad_number          INTEGER,
  pace                  INTEGER NOT NULL DEFAULT 50,
  shooting              INTEGER NOT NULL DEFAULT 50,
  passing               INTEGER NOT NULL DEFAULT 50,
  dribbling             INTEGER NOT NULL DEFAULT 50,
  defending             INTEGER NOT NULL DEFAULT 50,
  physical              INTEGER NOT NULL DEFAULT 50,
  goalkeeping           INTEGER NOT NULL DEFAULT 30,
  -- sub-attributes: each category above is the rounded average of its three
  -- sub-stats, which is what development/admin edits actually touch.
  pace_acceleration     INTEGER NOT NULL DEFAULT 50,
  pace_sprint_speed     INTEGER NOT NULL DEFAULT 50,
  pace_agility          INTEGER NOT NULL DEFAULT 50,
  shoot_finishing       INTEGER NOT NULL DEFAULT 50,
  shoot_power           INTEGER NOT NULL DEFAULT 50,
  shoot_long_shots      INTEGER NOT NULL DEFAULT 50,
  pass_short            INTEGER NOT NULL DEFAULT 50,
  pass_long             INTEGER NOT NULL DEFAULT 50,
  pass_vision           INTEGER NOT NULL DEFAULT 50,
  dribble_control       INTEGER NOT NULL DEFAULT 50,
  dribble_balance       INTEGER NOT NULL DEFAULT 50,
  dribble_composure     INTEGER NOT NULL DEFAULT 50,
  defend_tackling       INTEGER NOT NULL DEFAULT 50,
  defend_marking        INTEGER NOT NULL DEFAULT 50,
  defend_interceptions  INTEGER NOT NULL DEFAULT 50,
  phys_strength         INTEGER NOT NULL DEFAULT 50,
  phys_stamina          INTEGER NOT NULL DEFAULT 50,
  phys_aggression       INTEGER NOT NULL DEFAULT 50,
  gk_reflexes           INTEGER NOT NULL DEFAULT 30,
  gk_handling           INTEGER NOT NULL DEFAULT 30,
  gk_positioning        INTEGER NOT NULL DEFAULT 30,
  potential             INTEGER NOT NULL DEFAULT 60,
  star_rating           NUMERIC(2,1) NOT NULL DEFAULT 2.5, -- 1.1 - 5.0
  development_rate      NUMERIC NOT NULL DEFAULT 1.0,
  form                  INTEGER NOT NULL DEFAULT 70,
  fitness               INTEGER NOT NULL DEFAULT 100,
  morale                INTEGER NOT NULL DEFAULT 75,
  injury_status         TEXT NOT NULL DEFAULT 'Healthy',
  injury_return_match   INTEGER,
  goals                 INTEGER NOT NULL DEFAULT 0,
  assists               INTEGER NOT NULL DEFAULT 0,
  appearances           INTEGER NOT NULL DEFAULT 0,
  yellow_cards          INTEGER NOT NULL DEFAULT 0,
  red_cards             INTEGER NOT NULL DEFAULT 0,
  is_star               BOOLEAN NOT NULL DEFAULT false,
  retired               BOOLEAN NOT NULL DEFAULT false,
  retired_season        INTEGER,
  career_history        JSONB NOT NULL DEFAULT '[]',
  -- contracts / economy
  wage                  BIGINT NOT NULL DEFAULT 0,
  contract_seasons_left INTEGER NOT NULL DEFAULT 0,  -- 0 = free agent / out of contract
  market_value          BIGINT NOT NULL DEFAULT 0,
  listed                BOOLEAN NOT NULL DEFAULT false,
  asking_price           BIGINT,
  wants_to_leave         BOOLEAN NOT NULL DEFAULT false,
  is_youth_product       BOOLEAN NOT NULL DEFAULT false,
  card_type              TEXT,                       -- NULL | 'hero' | 'legend' | 'special' — admin-assigned marquee cards, never transferred
  injury_matches_remaining INTEGER NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS matches (
  id              SERIAL PRIMARY KEY,
  stage_id        INTEGER REFERENCES stages(id) ON DELETE SET NULL,
  season          INTEGER NOT NULL,
  matchday        INTEGER NOT NULL,
  home_team_id    INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  away_team_id    INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  status          TEXT NOT NULL DEFAULT 'scheduled',
  home_score      INTEGER NOT NULL DEFAULT 0,
  away_score      INTEGER NOT NULL DEFAULT 0,
  minute          INTEGER NOT NULL DEFAULT 0,
  home_formation  TEXT,
  away_formation  TEXT,
  events          JSONB NOT NULL DEFAULT '[]',
  stats           JSONB NOT NULL DEFAULT '{}',
  played_at       TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS season_history (
  id                SERIAL PRIMARY KEY,
  season            INTEGER NOT NULL,
  stage_name        TEXT NOT NULL,
  champion          TEXT,
  promoted          TEXT[] DEFAULT '{}',
  relegated         TEXT[] DEFAULT '{}',
  recorded_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS retirements (
  id            SERIAL PRIMARY KEY,
  season        INTEGER NOT NULL,
  player_name   TEXT NOT NULL,
  team_name     TEXT,
  age           INTEGER,
  final_overall INTEGER,
  position      TEXT,
  goals         INTEGER,
  appearances   INTEGER,
  recorded_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS transfer_offers (
  id             SERIAL PRIMARY KEY,
  player_id      INTEGER REFERENCES players(id) ON DELETE CASCADE,
  from_team_id   INTEGER REFERENCES teams(id) ON DELETE CASCADE, -- buyer
  to_team_id     INTEGER REFERENCES teams(id) ON DELETE CASCADE, -- current owner
  amount         BIGINT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending', -- pending | accepted | rejected | withdrawn
  message        TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at    TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS contract_offers (
  id             SERIAL PRIMARY KEY,
  player_id      INTEGER REFERENCES players(id) ON DELETE CASCADE,
  team_id        INTEGER REFERENCES teams(id) ON DELETE CASCADE,
  wage           BIGINT NOT NULL,
  seasons        INTEGER NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending', -- pending | accepted | rejected
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sponsor_offers (
  id             SERIAL PRIMARY KEY,
  team_id        INTEGER REFERENCES teams(id) ON DELETE CASCADE,
  season         INTEGER NOT NULL,
  sponsor_name   TEXT NOT NULL,
  value          BIGINT NOT NULL,
  length_seasons INTEGER NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending', -- pending | accepted | rejected | expired
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auctions (
  id                SERIAL PRIMARY KEY,
  season            INTEGER NOT NULL,
  status            TEXT NOT NULL DEFAULT 'idle', -- idle | active | completed
  player_queue      INTEGER[] DEFAULT '{}',
  queue_position    INTEGER NOT NULL DEFAULT 0,
  current_player_id INTEGER,
  current_bid       BIGINT NOT NULL DEFAULT 0,
  current_bid_team  INTEGER,
  deadline_at       TIMESTAMPTZ,
  log               JSONB NOT NULL DEFAULT '[]',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS news_items (
  id            SERIAL PRIMARY KEY,
  season        INTEGER,
  category      TEXT NOT NULL DEFAULT 'general', -- transfer | contract | sponsor | youth | retirement | match | league
  text          TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS marquee_requests (
  id            SERIAL PRIMARY KEY,
  team_id       INTEGER REFERENCES teams(id) ON DELETE CASCADE,
  card_type     TEXT NOT NULL, -- hero | legend | special
  status        TEXT NOT NULL DEFAULT 'pending', -- pending | fulfilled | dismissed
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_players_team ON players(team_id);
CREATE INDEX IF NOT EXISTS idx_players_listed ON players(listed) WHERE listed = true;
CREATE INDEX IF NOT EXISTS idx_matches_stage ON matches(stage_id, season, matchday);
CREATE INDEX IF NOT EXISTS idx_teams_stage ON teams(stage_id);
CREATE INDEX IF NOT EXISTS idx_transfer_offers_status ON transfer_offers(status);
CREATE INDEX IF NOT EXISTS idx_news_created ON news_items(created_at DESC);

-- Safety net: pick up new columns if this runs against a DB created by an
-- earlier version of this schema.
ALTER TABLE teams   ADD COLUMN IF NOT EXISTS medical_level INTEGER NOT NULL DEFAULT 1;
ALTER TABLE teams   ADD COLUMN IF NOT EXISTS youth_coach_name TEXT;
ALTER TABLE teams   ADD COLUMN IF NOT EXISTS medical_staff_name TEXT;
ALTER TABLE players ADD COLUMN IF NOT EXISTS card_type TEXT;
ALTER TABLE players ADD COLUMN IF NOT EXISTS injury_matches_remaining INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN IF NOT EXISTS pace_acceleration INTEGER NOT NULL DEFAULT 50;
ALTER TABLE players ADD COLUMN IF NOT EXISTS pace_sprint_speed INTEGER NOT NULL DEFAULT 50;
ALTER TABLE players ADD COLUMN IF NOT EXISTS pace_agility INTEGER NOT NULL DEFAULT 50;
ALTER TABLE players ADD COLUMN IF NOT EXISTS shoot_finishing INTEGER NOT NULL DEFAULT 50;
ALTER TABLE players ADD COLUMN IF NOT EXISTS shoot_power INTEGER NOT NULL DEFAULT 50;
ALTER TABLE players ADD COLUMN IF NOT EXISTS shoot_long_shots INTEGER NOT NULL DEFAULT 50;
ALTER TABLE players ADD COLUMN IF NOT EXISTS pass_short INTEGER NOT NULL DEFAULT 50;
ALTER TABLE players ADD COLUMN IF NOT EXISTS pass_long INTEGER NOT NULL DEFAULT 50;
ALTER TABLE players ADD COLUMN IF NOT EXISTS pass_vision INTEGER NOT NULL DEFAULT 50;
ALTER TABLE players ADD COLUMN IF NOT EXISTS dribble_control INTEGER NOT NULL DEFAULT 50;
ALTER TABLE players ADD COLUMN IF NOT EXISTS dribble_balance INTEGER NOT NULL DEFAULT 50;
ALTER TABLE players ADD COLUMN IF NOT EXISTS dribble_composure INTEGER NOT NULL DEFAULT 50;
ALTER TABLE players ADD COLUMN IF NOT EXISTS defend_tackling INTEGER NOT NULL DEFAULT 50;
ALTER TABLE players ADD COLUMN IF NOT EXISTS defend_marking INTEGER NOT NULL DEFAULT 50;
ALTER TABLE players ADD COLUMN IF NOT EXISTS defend_interceptions INTEGER NOT NULL DEFAULT 50;
ALTER TABLE players ADD COLUMN IF NOT EXISTS phys_strength INTEGER NOT NULL DEFAULT 50;
ALTER TABLE players ADD COLUMN IF NOT EXISTS phys_stamina INTEGER NOT NULL DEFAULT 50;
ALTER TABLE players ADD COLUMN IF NOT EXISTS phys_aggression INTEGER NOT NULL DEFAULT 50;
ALTER TABLE players ADD COLUMN IF NOT EXISTS gk_reflexes INTEGER NOT NULL DEFAULT 30;
ALTER TABLE players ADD COLUMN IF NOT EXISTS gk_handling INTEGER NOT NULL DEFAULT 30;
ALTER TABLE players ADD COLUMN IF NOT EXISTS gk_positioning INTEGER NOT NULL DEFAULT 30;
ALTER TABLE players ADD COLUMN IF NOT EXISTS playstyle VARCHAR(20) NOT NULL DEFAULT 'Balanced';
ALTER TABLE players ADD COLUMN IF NOT EXISTS formation_fit JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE coaches ADD COLUMN IF NOT EXISTS playstyle VARCHAR(20) NOT NULL DEFAULT 'Balanced';
ALTER TABLE coaches ADD COLUMN IF NOT EXISTS formation_fit JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Chemistry between two players who have been squadmates: builds from
-- shared minutes on the pitch (per match) and shared seasons on the same
-- roster (at season rollover), moderated by their ages. One row per
-- unordered pair (player_a_id < player_b_id always), so it persists even
-- if they later transfer to different clubs or end up teammates again.
CREATE TABLE IF NOT EXISTS chemistry_pairs (
  player_a_id       INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  player_b_id       INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  team_id           INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  minutes_together  INTEGER NOT NULL DEFAULT 0,
  seasons_together  INTEGER NOT NULL DEFAULT 0,
  chemistry_score   NUMERIC(5,2) NOT NULL DEFAULT 0,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (player_a_id, player_b_id)
);
CREATE INDEX IF NOT EXISTS idx_chemistry_team ON chemistry_pairs(team_id);

-- Every account creation, password reset, and role change — visible to the
-- super admin so club-login credentials stay auditable and easy to manage.
CREATE TABLE IF NOT EXISTS audit_log (
  id            SERIAL PRIMARY KEY,
  actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  actor_name    TEXT,
  action        TEXT NOT NULL,
  target_type   TEXT,
  target_id     INTEGER,
  details       JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);
