-- SET-01: move the business rules the trainer owns out of application
-- constants and into tables they can edit without a deploy.

-- Package sizes ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS package_sizes (
  sessions_total INT PRIMARY KEY CHECK (sessions_total > 0)
);

INSERT INTO package_sizes (sessions_total)
VALUES (1), (4), (8), (12), (16)
ON CONFLICT (sessions_total) DO NOTHING;

-- package_pricing hardcoded the same list in a CHECK. Point it at the table
-- instead so a new size only has to be added in one place.
ALTER TABLE package_pricing
  DROP CONSTRAINT IF EXISTS package_pricing_sessions_total_check;

ALTER TABLE package_pricing
  ADD CONSTRAINT package_pricing_sessions_total_fkey
    FOREIGN KEY (sessions_total) REFERENCES package_sizes (sessions_total);

-- Business hours -----------------------------------------------------------

-- One row per bookable slot. day_of_week follows ISO numbering to match
-- sessions_training_day_check: 1 = Monday ... 6 = Saturday, no Sunday.
CREATE TABLE IF NOT EXISTS business_hours (
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 1 AND 6),
  start_time TIME NOT NULL,
  PRIMARY KEY (day_of_week, start_time)
);

-- Seeded with exactly the slots that were in businessRules.js: 05:00-19:00 on
-- weekdays, 05:00-10:00 on Saturday.
INSERT INTO business_hours (day_of_week, start_time)
SELECT day_of_week, make_time(hour, 0, 0)
FROM generate_series(1, 5) AS day_of_week
CROSS JOIN generate_series(5, 19) AS hour
ON CONFLICT DO NOTHING;

INSERT INTO business_hours (day_of_week, start_time)
SELECT 6, make_time(hour, 0, 0)
FROM generate_series(5, 10) AS hour
ON CONFLICT DO NOTHING;

-- Scheduling settings ------------------------------------------------------

ALTER TABLE scheduling_settings
  ADD COLUMN IF NOT EXISTS package_expiry_months INT NOT NULL DEFAULT 2
    CHECK (package_expiry_months > 0);

-- Session length was pinned to exactly 60 in two places. The trainer owns it
-- now, so both become "any positive number of minutes".
ALTER TABLE scheduling_settings
  DROP CONSTRAINT IF EXISTS scheduling_settings_session_duration_minutes_check;

ALTER TABLE scheduling_settings
  ADD CONSTRAINT scheduling_settings_session_duration_minutes_check
    CHECK (session_duration_minutes > 0);

ALTER TABLE sessions
  DROP CONSTRAINT IF EXISTS sessions_duration_minutes_check;

ALTER TABLE sessions
  ADD CONSTRAINT sessions_duration_minutes_check
    CHECK (duration_minutes > 0);

-- Package expiry -----------------------------------------------------------

-- packages_exact_two_month_expiry_check hardcoded two months. A CHECK cannot
-- read another table, so the same rule moves to a trigger that reads the
-- configured window.
ALTER TABLE packages
  DROP CONSTRAINT IF EXISTS packages_exact_two_month_expiry_check;

CREATE OR REPLACE FUNCTION packages_enforce_configured_expiry()
RETURNS TRIGGER AS $$
DECLARE
  expiry_months INT;
  expected_expiry DATE;
BEGIN
  SELECT package_expiry_months INTO expiry_months
  FROM scheduling_settings
  WHERE id = 1;

  expected_expiry := (NEW.purchase_date + make_interval(months => expiry_months))::date;

  IF NEW.expiry_date <> expected_expiry THEN
    RAISE EXCEPTION
      'packages_configured_expiry_check: expiry_date must be %, got %',
      expected_expiry, NEW.expiry_date
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS packages_configured_expiry ON packages;

CREATE TRIGGER packages_configured_expiry
  BEFORE INSERT OR UPDATE OF purchase_date, expiry_date ON packages
  FOR EACH ROW
  EXECUTE FUNCTION packages_enforce_configured_expiry();
