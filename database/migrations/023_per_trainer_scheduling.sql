-- AUTH-05: training hours, session length, group capacity and the package
-- expiry window belong to the trainer, not the business. business_hours held
-- one week for everybody and scheduling_settings was a single row pinned to
-- id = 1, so two trainers could not keep different hours.

-- Training hours -----------------------------------------------------------

ALTER TABLE business_hours
  ADD COLUMN IF NOT EXISTS trainer_user_id BIGINT REFERENCES trainer_users(id);

-- The same owner migrations 021 and 022 chose, for the same reason: whoever
-- was running the business before it had more than one trainer.
DO $$
DECLARE
  owner_id BIGINT;
BEGIN
  SELECT id INTO owner_id FROM trainer_users WHERE role = 'admin' ORDER BY id LIMIT 1;
  IF owner_id IS NULL THEN
    SELECT id INTO owner_id FROM trainer_users ORDER BY id LIMIT 1;
  END IF;
  IF owner_id IS NULL AND EXISTS (SELECT 1 FROM business_hours) THEN
    RAISE EXCEPTION 'Cannot assign training hours: there are hours but no trainer_users row. Sign in once to create the bootstrap trainer, then run migrations again.';
  END IF;
  UPDATE business_hours SET trainer_user_id = owner_id WHERE trainer_user_id IS NULL;
END $$;

ALTER TABLE business_hours ALTER COLUMN trainer_user_id SET NOT NULL;

ALTER TABLE business_hours DROP CONSTRAINT IF EXISTS business_hours_pkey;
ALTER TABLE business_hours
  ADD CONSTRAINT business_hours_pkey PRIMARY KEY (trainer_user_id, day_of_week, start_time);

-- Scheduling settings ------------------------------------------------------

-- Was a singleton: id SMALLINT with CHECK (id = 1). The trainer is the key now.
ALTER TABLE scheduling_settings
  ADD COLUMN IF NOT EXISTS trainer_user_id BIGINT REFERENCES trainer_users(id);

DO $$
DECLARE
  owner_id BIGINT;
BEGIN
  SELECT id INTO owner_id FROM trainer_users WHERE role = 'admin' ORDER BY id LIMIT 1;
  IF owner_id IS NULL THEN
    SELECT id INTO owner_id FROM trainer_users ORDER BY id LIMIT 1;
  END IF;
  IF owner_id IS NULL AND EXISTS (SELECT 1 FROM scheduling_settings) THEN
    RAISE EXCEPTION 'Cannot assign scheduling settings: there are settings but no trainer_users row. Sign in once to create the bootstrap trainer, then run migrations again.';
  END IF;
  UPDATE scheduling_settings SET trainer_user_id = owner_id WHERE trainer_user_id IS NULL;
END $$;

DELETE FROM scheduling_settings WHERE trainer_user_id IS NULL;

ALTER TABLE scheduling_settings DROP CONSTRAINT IF EXISTS scheduling_settings_id_check;
ALTER TABLE scheduling_settings DROP CONSTRAINT IF EXISTS scheduling_settings_pkey;
ALTER TABLE scheduling_settings DROP COLUMN IF EXISTS id;
ALTER TABLE scheduling_settings ALTER COLUMN trainer_user_id SET NOT NULL;
ALTER TABLE scheduling_settings
  ADD CONSTRAINT scheduling_settings_pkey PRIMARY KEY (trainer_user_id);

-- Defaults for a trainer who has none --------------------------------------

-- The values businessRules.js used to hardcode: 05:00-19:00 Monday to Friday,
-- 05:00-10:00 on Saturday, no Sunday.
CREATE OR REPLACE FUNCTION seed_trainer_scheduling(target_trainer_id BIGINT)
RETURNS void AS $$
BEGIN
  INSERT INTO business_hours (trainer_user_id, day_of_week, start_time)
  SELECT target_trainer_id, day_of_week, make_time(hour, 0, 0)
  FROM generate_series(1, 5) AS day_of_week
  CROSS JOIN generate_series(5, 19) AS hour
  ON CONFLICT DO NOTHING;

  INSERT INTO business_hours (trainer_user_id, day_of_week, start_time)
  SELECT target_trainer_id, 6, make_time(hour, 0, 0)
  FROM generate_series(5, 10) AS hour
  ON CONFLICT DO NOTHING;

  INSERT INTO scheduling_settings (trainer_user_id)
  VALUES (target_trainer_id)
  ON CONFLICT (trainer_user_id) DO NOTHING;
END $$ LANGUAGE plpgsql;

-- Every trainer who already existed before this migration.
DO $$
DECLARE
  existing_trainer BIGINT;
BEGIN
  FOR existing_trainer IN
    SELECT id FROM trainer_users ORDER BY id
  LOOP
    PERFORM seed_trainer_scheduling(existing_trainer);
  END LOOP;
END $$;

-- And every trainer created from now on, whichever path creates them. There
-- is already more than one (the bootstrap and Google sign-up, with email
-- sign-up to come), and a trigger cannot be forgotten by a new one.
CREATE OR REPLACE FUNCTION trainer_users_seed_scheduling()
RETURNS trigger AS $$
BEGIN
  PERFORM seed_trainer_scheduling(NEW.id);
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trainer_users_seed_scheduling ON trainer_users;

CREATE TRIGGER trainer_users_seed_scheduling
  AFTER INSERT ON trainer_users
  FOR EACH ROW EXECUTE FUNCTION trainer_users_seed_scheduling();

-- The expiry rule follows the owner too -------------------------------------

-- packages_enforce_configured_expiry (migration 017) read the single
-- scheduling_settings row by id. The window belongs to the client's trainer
-- now, so it is reached through the client.
CREATE OR REPLACE FUNCTION packages_enforce_configured_expiry()
RETURNS TRIGGER AS $$
DECLARE
  expiry_months INT;
  expected_expiry DATE;
BEGIN
  SELECT settings.package_expiry_months INTO expiry_months
  FROM clients client
  JOIN scheduling_settings settings ON settings.trainer_user_id = client.trainer_user_id
  WHERE client.id = NEW.client_id;

  IF expiry_months IS NULL THEN
    RAISE EXCEPTION
      'packages_configured_expiry_check: no expiry window for the trainer who owns client %',
      NEW.client_id
      USING ERRCODE = 'check_violation';
  END IF;

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
