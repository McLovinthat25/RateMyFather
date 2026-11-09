-- Add the attendance-duration answer to reviews.
-- The review form asks how long the reviewer has attended the parish or
-- known the priest (required dropdown, 8 buckets); the answer is stored
-- here and shown on published review cards.
-- Idempotent: safe to re-run on boot.
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS attendance_duration TEXT;
