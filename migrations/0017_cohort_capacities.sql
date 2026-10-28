CREATE TABLE IF NOT EXISTS cohort_capacities (
  cohort TEXT NOT NULL,
  track TEXT NOT NULL,
  paths TEXT NOT NULL CHECK(json_valid(paths)),
  male_limit INTEGER CHECK(male_limit IS NULL OR (typeof(male_limit) = 'integer' AND male_limit BETWEEN 0 AND 10000)),
  female_limit INTEGER CHECK(female_limit IS NULL OR (typeof(female_limit) = 'integer' AND female_limit BETWEEN 0 AND 10000)),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (cohort, track)
);
CREATE INDEX IF NOT EXISTS idx_sub_capacity ON submissions(cohort, gender, status);

-- The check and insertion run in the same SQLite write transaction, including simultaneous submissions.
-- Exclude this application ID so retrying an accepted submission does not consume a second seat.
CREATE TRIGGER IF NOT EXISTS submissions_capacity_guard
BEFORE INSERT ON submissions
WHEN COALESCE(NEW.status, '') IN ('', '송금확인') AND COALESCE(NEW.plan, '') NOT IN ('prealert', 'review')
BEGIN
  SELECT RAISE(ABORT, 'capacity_gender_required')
  WHERE COALESCE(NEW.gender, '') NOT IN ('남성', '여성') AND EXISTS (
    SELECT 1 FROM cohort_capacities c WHERE c.cohort = NEW.cohort
    AND (NEW.track = c.track OR NEW.path IN (SELECT value FROM json_each(c.paths)))
    AND (c.male_limit IS NOT NULL OR c.female_limit IS NOT NULL)
  );
  SELECT RAISE(ABORT, 'cohort_capacity_full') WHERE EXISTS (
    SELECT 1 FROM cohort_capacities c WHERE c.cohort = NEW.cohort
    AND (NEW.track = c.track OR NEW.path IN (SELECT value FROM json_each(c.paths)))
    AND (CASE NEW.gender WHEN '남성' THEN c.male_limit WHEN '여성' THEN c.female_limit END) IS NOT NULL
    AND (SELECT COUNT(*) FROM submissions s WHERE s.cohort = NEW.cohort
      AND (s.track = c.track OR s.path IN (SELECT value FROM json_each(c.paths))) AND s.gender = NEW.gender
      AND COALESCE(s.plan, '') NOT IN ('prealert', 'review')
      AND COALESCE(s.status, '') IN ('', '송금확인') AND s.application_id <> NEW.application_id)
      >= (CASE NEW.gender WHEN '남성' THEN c.male_limit WHEN '여성' THEN c.female_limit END)
  );
END;
