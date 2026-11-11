-- 005_parish_leaderboard.sql: optional home-parish arcade leaderboard.
-- A player may set a home parish (stored only in their own browser); when
-- one is set, a finished game's score counts toward that parish's total on
-- a per-game leaderboard shared across visitors. No personal information
-- is collected or stored: the parish name, city, state and the score are
-- all that is kept. A parish is keyed by its normalized name + city +
-- state (lowercase, periods dropped, whitespace collapsed), so spelling
-- variants of the same parish ("St. Patrick" / "St Patrick") land on one
-- row. A player who never sets a home parish plays exactly as before.
CREATE TABLE IF NOT EXISTS parish_scores (
  id SERIAL PRIMARY KEY,
  game TEXT NOT NULL,
  parish_key TEXT NOT NULL,
  parish TEXT NOT NULL,
  city TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT '',
  total_score BIGINT NOT NULL DEFAULT 0,
  games_played INTEGER NOT NULL DEFAULT 0,
  best_score INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (game, parish_key)
);
CREATE INDEX IF NOT EXISTS parish_scores_game_idx ON parish_scores (game, total_score DESC);
