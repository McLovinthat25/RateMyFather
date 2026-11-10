-- RateMyFather sweep status columns (verification sweep, Nov 8, 2026).
-- Adds life-status and verification tracking to priests.
-- Idempotent: safe to re-run on boot (all ADD COLUMN ... IF NOT EXISTS).
-- Applied by scripts/apply-sweep-mapping.js using sweep-apply-mapping.json.
-- The priests table itself is unchanged otherwise; the 2017 directory values
-- in parish/city/state are only overwritten where the sweep gave a definitive
-- new assignment (see the mapping file).

ALTER TABLE priests ADD COLUMN IF NOT EXISTS life_status TEXT;
-- life_status values:
--   'active'      confirmed currently serving (same parish, or a new parish
--                  in parish/city/state after a verified move)
--   'moved'       confirmed moved from the 2017 parish, but the new parish
--                  could not be extracted reliably (see status_note)
--   'retired'     confirmed retired (parish set to 'Retired', city/state NULL,
--                  matching the 2017 directory convention for retired priests)
--   'deceased'    confirmed deceased (death_date set when a date was found)
--   'on_leave'    on a leave of absence (administrative, medical, personal,
--                  study/sabbatical; see status_note for the specific kind)
--   'removed'     removed from public ministry
--   'laicized'    laicized / dismissed from the clerical state
--   'suspended'   suspended from ministry
--   'moved_out'   moved out of the diocese (parish left as the last known
--                  2017 assignment; see status_note for the destination)
--   'bishop'      became a bishop (see status_note for the see)
--   NULL          unknown (sweep could not verify) or not swept

ALTER TABLE priests ADD COLUMN IF NOT EXISTS verification_status TEXT;
-- verification_status values:
--   'verified'            sweep confirmed the status (or the new parish)
--   'verified_2017_only'  retired, but the evidence is the 2017 listing alone
--                          (no independent confirmation); parish NOT changed
--   'unknown'             sweep checked but could not verify this priest
--   'not_swept'           diocese/order code was out of scope for the sweep

ALTER TABLE priests ADD COLUMN IF NOT EXISTS verification_source TEXT;
-- Short source for the sweep finding (e.g. a diocese directory or obituary).
-- NULL when there is no sweep finding for this priest.

ALTER TABLE priests ADD COLUMN IF NOT EXISTS status_note TEXT;
-- The sweep finding text (up to 500 chars) explaining the status or the move.
-- NULL when there is no sweep finding for this priest.

ALTER TABLE priests ADD COLUMN IF NOT EXISTS death_date TEXT;
-- ISO date (YYYY-MM-DD) when the sweep finding gave a death date, or a
-- 4-digit year when only the year was found. NULL otherwise (including for
-- deceased priests whose finding gave no date).

CREATE INDEX IF NOT EXISTS priests_life_status_idx ON priests (life_status);
CREATE INDEX IF NOT EXISTS priests_verification_status_idx ON priests (verification_status);
