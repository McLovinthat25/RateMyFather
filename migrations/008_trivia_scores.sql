-- 008_trivia_scores.sql: daily trivia leaderboard with display names.
-- One row per (day, name): each visitor's best Kahoot-style round of the
-- day under the short display name they typed (or "Anonymous"). Points
-- are speed-based, up to 1,000 per question, 3,000 per round; among equal
-- points the faster total time wins. The name is only a display name for
-- the day's board: no account, no email, no IP address is stored with it.
-- Names are validated server side (length, characters, and the shared
-- profanity filter in lib/profanity.js) before any row is written, so a
-- blocked name never reaches this table. Replaces trivia_daily_best
-- (006), which stored a single anonymous best per day and is left in
-- place, no longer written.
CREATE TABLE IF NOT EXISTS trivia_daily_scores (
  day DATE NOT NULL,
  name TEXT NOT NULL,
  points INTEGER NOT NULL DEFAULT 0,
  correct INTEGER NOT NULL DEFAULT 0,
  ms INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- One best row per name per day, case-insensitive, so one player cannot
-- flood the board under the same name with different capitalisation.
CREATE UNIQUE INDEX IF NOT EXISTS trivia_daily_scores_day_name_idx
  ON trivia_daily_scores (day, lower(name));
CREATE INDEX IF NOT EXISTS trivia_daily_scores_day_points_idx
  ON trivia_daily_scores (day, points DESC, ms ASC);
