-- 007_parish_daily_cap.sql: per-person daily contribution cap for the
-- parish leaderboard. One person can contribute up to DAILY_PARISH_CAP
-- points per game per day; it resets each day (Eastern date). One row
-- per (day, visitor token hash, game) with the points that visitor has
-- contributed for that game that day.
--
-- The token is the same one-way SHA-256 hash of IP + user-agent the
-- rate limiter already uses in memory (see lib/screening.js
-- sourceTokenHash). No IP, user-agent, name, email or account is stored,
-- and the day key means a row is only useful for the day it belongs to.
-- The cap is enforced server side in POST /api/leaderboard/score: a
-- submission is credited only up to the remaining room for the day, so a
-- single player cannot farm points endlessly and carry a parish alone.
CREATE TABLE IF NOT EXISTS parish_daily_contrib (
  day TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  game TEXT NOT NULL,
  contributed BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (day, token_hash, game)
);
CREATE INDEX IF NOT EXISTS parish_daily_contrib_day_idx ON parish_daily_contrib (day);
