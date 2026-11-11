-- 009_score_rate_limits.sql: database-backed score rate limits
-- (audit F-07, Iteration 2). The arcade/trivia score rate limit
-- (one submission per game per visitor per 30 s, identical repeat
-- dropped within 60 s) used to live in an in-process Map, so it reset
-- on every deploy/restart and was per-process. It now lives here, keyed
-- by the same one-way SHA-256 token hash the duplicate-review and
-- daily-cap checks use (server-determined client IP + user agent, see
-- lib/client-ip.js). No IP, user-agent, name, or score history is
-- stored — only the last submission time and score per (token, game),
-- which is all the check needs. Rows are upserted on every accepted
-- submission, so the table stays one row per (token, game).
CREATE TABLE IF NOT EXISTS score_rate_limits (
  token_hash TEXT NOT NULL,
  game TEXT NOT NULL,
  last_submit TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_score INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (token_hash, game)
);
