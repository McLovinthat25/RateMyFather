-- 010_owner_sessions.sql: server-side owner session records
-- (audit F-05, Iteration 2). The owner session cookie is a signed
-- payload carrying an expiry and a random session id (sid); this table
-- is the allow-list verifySession checks. A sid that is not here — or
-- whose expiry has passed — is rejected, so logout (which deletes the
-- row) actually revokes the session instead of merely clearing the
-- browser's copy. The sid is a random UUID with no IP or user-agent
-- attached: the owner moves between networks, so the session is
-- deliberately NOT bound to IP or user-agent (that trade-off is
-- recorded in server.js). Expired rows are pruned opportunistically
-- on login; they are harmless if left, since verifySession also
-- checks expires_at.
CREATE TABLE IF NOT EXISTS owner_sessions (
  sid TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS owner_sessions_expires_idx ON owner_sessions (expires_at);
