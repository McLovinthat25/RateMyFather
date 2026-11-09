-- 004_church_beauty.sql: optional church-building beauty rating on reviews.
-- church_beauty is a 1-5 rating of the church BUILDING, not the priest. It is
-- stored on the review but is never part of the priest's score, averages,
-- rankings, or category lists. Nullable: the rating is optional in the form.
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS church_beauty INTEGER
  CHECK (church_beauty IS NULL OR (church_beauty BETWEEN 1 AND 5));
CREATE INDEX IF NOT EXISTS idx_reviews_church_beauty ON reviews (priest_id, church_beauty)
  WHERE status = 'approved' AND church_beauty IS NOT NULL;
