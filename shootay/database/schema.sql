-- SHOOTAY database schema (PostgreSQL 14+). Idempotent: safe to run on every boot.

CREATE TABLE IF NOT EXISTS users (
  id            BIGSERIAL PRIMARY KEY,
  username      VARCHAR(16) NOT NULL,
  username_lc   VARCHAR(16) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  deyes         BIGINT NOT NULL DEFAULT 0 CHECK (deyes >= 0),
  xp            BIGINT NOT NULL DEFAULT 0,
  kills         INT NOT NULL DEFAULT 0,
  deaths        INT NOT NULL DEFAULT 0,
  headshots     INT NOT NULL DEFAULT 0,
  wins          INT NOT NULL DEFAULT 0,
  matches       INT NOT NULL DEFAULT 0,
  loadout       JSONB NOT NULL DEFAULT '{}',
  outfit        JSONB NOT NULL DEFAULT '{}',
  settings      JSONB NOT NULL DEFAULT '{}',
  equipped_fx   JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Everything a player owns. item_type: weapon | attachment | clothing | skin | effect
CREATE TABLE IF NOT EXISTS inventory (
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_type   VARCHAR(12) NOT NULL,
  item_id     VARCHAR(64) NOT NULL,
  source      VARCHAR(16) NOT NULL DEFAULT 'grant',
  duplicates  INT NOT NULL DEFAULT 0,
  obtained_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, item_type, item_id)
);

-- Append-only currency ledger. The unique key makes every reward idempotent:
-- one row per (user, reason, reference) — a match, a mission claim, a box opening.
CREATE TABLE IF NOT EXISTS transactions (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount        BIGINT NOT NULL,
  reason        VARCHAR(24) NOT NULL,
  ref           VARCHAR(64) NOT NULL,
  balance_after BIGINT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, reason, ref)
);
CREATE INDEX IF NOT EXISTS transactions_user_idx ON transactions (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS matches (
  id         UUID PRIMARY KEY,
  mode       VARCHAR(12) NOT NULL,
  map        VARCHAR(24) NOT NULL,
  private    BOOLEAN NOT NULL DEFAULT false,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  summary    JSONB NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS match_players (
  match_id       UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  user_id        BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team           SMALLINT NOT NULL DEFAULT -1,
  kills          INT NOT NULL DEFAULT 0,
  rewarded_kills INT NOT NULL DEFAULT 0,
  deaths         INT NOT NULL DEFAULT 0,
  score          INT NOT NULL DEFAULT 0,
  placement      INT NOT NULL DEFAULT 0,
  won            BOOLEAN NOT NULL DEFAULT false,
  deyes          INT NOT NULL DEFAULT 0,
  xp             INT NOT NULL DEFAULT 0,
  PRIMARY KEY (match_id, user_id)
);

-- The 6,000-row mission library (seeded by database/setup.ts from shared/missions.ts).
CREATE TABLE IF NOT EXISTS missions (
  id         VARCHAR(8) PRIMARY KEY,
  type       VARCHAR(16) NOT NULL,
  target     INT NOT NULL,
  difficulty VARCHAR(8) NOT NULL,
  reward     INT NOT NULL,
  title      TEXT NOT NULL UNIQUE,
  mode       VARCHAR(12),
  map        VARCHAR(24),
  cat        VARCHAR(12),
  weapon     VARCHAR(24)
);
CREATE INDEX IF NOT EXISTS missions_difficulty_idx ON missions (difficulty);

CREATE TABLE IF NOT EXISTS user_missions (
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day        DATE NOT NULL,
  mission_id VARCHAR(8) NOT NULL REFERENCES missions(id),
  slot       SMALLINT NOT NULL,
  progress   INT NOT NULL DEFAULT 0,
  claimed    BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (user_id, day, slot),
  UNIQUE (user_id, day, mission_id)
);
CREATE INDEX IF NOT EXISTS user_missions_recent_idx ON user_missions (user_id, mission_id, day);

-- status: pending | accepted. One row per pair, requester is user_a.
CREATE TABLE IF NOT EXISTS friendships (
  user_a     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status     VARCHAR(10) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_a, user_b),
  CHECK (user_a <> user_b)
);
CREATE INDEX IF NOT EXISTS friendships_b_idx ON friendships (user_b);

-- Catalogue extensions: licensed brand collections or approved user uploads added over time.
-- Rows are merged with the built-in original designs when the catalogue is served.
CREATE TABLE IF NOT EXISTS catalog_items (
  id       VARCHAR(64) PRIMARY KEY,
  name     TEXT NOT NULL,
  brand    TEXT NOT NULL,
  slot     VARCHAR(12) NOT NULL,
  style    VARCHAR(24) NOT NULL,
  tags     TEXT[] NOT NULL DEFAULT '{}',
  rarity   VARCHAR(12) NOT NULL DEFAULT 'common',
  price    INT NOT NULL DEFAULT 0,
  color    INT NOT NULL DEFAULT 0,
  color2   INT NOT NULL DEFAULT 0,
  accent   INT NOT NULL DEFAULT 0,
  license  VARCHAR(10) NOT NULL CHECK (license IN ('licensed', 'ugc')),
  license_note TEXT NOT NULL,
  enabled  BOOLEAN NOT NULL DEFAULT true,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS news (
  id         SERIAL PRIMARY KEY,
  tag        VARCHAR(16) NOT NULL DEFAULT 'NEWS',
  title      TEXT NOT NULL UNIQUE,
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
