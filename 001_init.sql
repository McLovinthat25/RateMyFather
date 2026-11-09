-- RateMyFather initial schema.
-- Run against DATABASE_URL, e.g.: psql "$DATABASE_URL" -f migrations/001_init.sql
-- Directory profiles come from scripts/seed.js (source 'directory_2017').
-- No reviews are ever seeded.

CREATE TABLE IF NOT EXISTS priests (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  parish TEXT,
  city TEXT,
  state TEXT,
  diocese_code TEXT,
  ordination_year INTEGER,
  source TEXT NOT NULL DEFAULT 'directory_2017',
  user_added BOOLEAN NOT NULL DEFAULT FALSE,
  zip TEXT,
  -- 'approved' = public. User-added priests start 'pending' until an owner approves them.
  -- Directory profiles are always 'approved' and are NEVER deletable (enforced in server.js).
  status TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS priests_name_idx ON priests (name);
CREATE INDEX IF NOT EXISTS priests_state_idx ON priests (state);
CREATE INDEX IF NOT EXISTS priests_status_idx ON priests (status);

CREATE TABLE IF NOT EXISTS reviews (
  id SERIAL PRIMARY KEY,
  priest_id INTEGER NOT NULL REFERENCES priests(id) ON DELETE CASCADE,
  pace INTEGER NOT NULL CHECK (pace BETWEEN 1 AND 5),
  homily INTEGER NOT NULL CHECK (homily BETWEEN 1 AND 5),
  likability INTEGER NOT NULL CHECK (likability BETWEEN 1 AND 5),
  mass_context TEXT,
  body TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  -- SHA-256 hash of (IP + user agent). Only the hash is stored, never raw identifying data.
  source_token_hash TEXT NOT NULL,
  abuse_flag BOOLEAN NOT NULL DEFAULT FALSE,
  -- Why a review was held (e.g. 'allegation', 'spike', 'borderline'). NULL for auto-approved.
  flag_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS reviews_priest_idx ON reviews (priest_id, status);
CREATE INDEX IF NOT EXISTS reviews_source_idx ON reviews (source_token_hash, created_at);

CREATE TABLE IF NOT EXISTS reports (
  id SERIAL PRIMARY KEY,
  review_id INTEGER REFERENCES reviews(id) ON DELETE CASCADE,
  priest_id INTEGER REFERENCES priests(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  details TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS corrections (
  id SERIAL PRIMARY KEY,
  priest_id INTEGER REFERENCES priests(id) ON DELETE CASCADE,
  -- 'correction' | 'reply' (right of reply) | 'removal'
  type TEXT NOT NULL,
  details TEXT NOT NULL,
  -- Optional contact supplied by the submitter. NEVER published or displayed publicly.
  contact TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS legal_notices (
  id SERIAL PRIMARY KEY,
  details TEXT NOT NULL,
  -- Optional contact supplied by the submitter. NEVER published.
  contact TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS moderation_audit (
  id SERIAL PRIMARY KEY,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id INTEGER,
  detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
