-- 006_trivia_highscore.sql: daily trivia high score, shared across visitors.
-- One row per day (Eastern date): the best round anyone has played that day.
-- A round is scored out of 3; among equal scores the fastest total time
-- wins, so a perfect round still has a record to beat. No personal
-- information is collected or stored: no name, no email, no account, no
-- IP address — only the best score and the time it took, per day.
-- The row for today is created on the first finished round of the day.
CREATE TABLE IF NOT EXISTS trivia_daily_best (
  day DATE PRIMARY KEY,
  best_score INTEGER NOT NULL DEFAULT 0,
  best_ms INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
