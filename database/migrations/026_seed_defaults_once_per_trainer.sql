-- SET-08: seed a trainer's defaults once, not whenever something is missing.
--
-- seed_trainer_scheduling and seed_trainer_catalogue insert with ON CONFLICT DO
-- NOTHING, so "the trainer deleted this" and "this was never created" look
-- identical to them and a removed default comes back. Removing one is ordinary
-- use: configuration.repository.replaceBusinessHours deletes every row for the
-- trainer and reinserts the submitted set, so a trainer narrowing their hours
-- in /settings has deleted rows on purpose.
--
-- Nothing is wrong on a database running today. Both seeders only ran inside
-- 023 and 024, which the runner has recorded as applied, and nothing in
-- backend/src calls either one. The live caller is the AFTER INSERT trigger on
-- trainer_users, firing for a trainer who has nothing yet to lose.
--
-- The trap is the next migration that ships a new default. The obvious way to
-- write it -- call a seeder for every existing trainer -- would silently undo
-- every trainer's customisation. A marker makes that impossible instead of
-- leaving a comment and hoping.
--
-- What this does NOT fix: restoring a dump older than 023. Those migrations run
-- before this one, so they would re-seed on the way past. The marker protects
-- seeding from here on.

ALTER TABLE trainer_users
  ADD COLUMN IF NOT EXISTS defaults_seeded_at TIMESTAMPTZ;

-- Every trainer that exists now has been through 023 and 024, so they are
-- seeded by definition. Marking them is what stops a later migration reaching
-- back and undoing their own hours, prices and programs.
UPDATE trainer_users SET defaults_seeded_at = NOW() WHERE defaults_seeded_at IS NULL;

-- The two seeders now refuse to run twice -------------------------------------

-- Same inserts as 023. The only change is the guard at the top and the comment
-- stating the rule, so the next person to add a default reads it here.
CREATE OR REPLACE FUNCTION seed_trainer_scheduling(target_trainer_id BIGINT)
RETURNS void AS $$
BEGIN
  -- SET-08. Once per trainer, never a gap filler. Calling this in a loop over
  -- existing trainers to ship a new default is exactly what the marker stops:
  -- it would put back every hour they had taken off their schedule. To change
  -- what a NEW trainer starts with, edit the inserts below. To change an
  -- EXISTING trainer's configuration, write a migration that targets the rows
  -- you mean and leaves their own choices alone.
  IF EXISTS (
    SELECT 1 FROM trainer_users
    WHERE id = target_trainer_id AND defaults_seeded_at IS NOT NULL
  ) THEN
    RETURN;
  END IF;

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

-- Same inserts as 024, same guard, same reason.
CREATE OR REPLACE FUNCTION seed_trainer_catalogue(target_trainer_id BIGINT)
RETURNS void AS $$
BEGIN
  -- SET-08. Once per trainer. See seed_trainer_scheduling above: a loop over
  -- existing trainers would restore every program, size and price they removed.
  IF EXISTS (
    SELECT 1 FROM trainer_users
    WHERE id = target_trainer_id AND defaults_seeded_at IS NOT NULL
  ) THEN
    RETURN;
  END IF;

  INSERT INTO package_sizes (trainer_user_id, sessions_total)
  SELECT target_trainer_id, size
  FROM (VALUES (1), (4), (8), (12), (16)) AS defaults(size)
  ON CONFLICT DO NOTHING;

  INSERT INTO programs (trainer_user_id, name, type)
  SELECT target_trainer_id, defaults.name, defaults.type
  FROM (VALUES
    ('Weight Loss', 'one_on_one'),
    ('Strength Training', 'one_on_one'),
    ('Small Groups', 'group'),
    ('Sports Specific Training', 'one_on_one'),
    ('Toning & Shaping', 'group')
  ) AS defaults(name, type)
  ON CONFLICT DO NOTHING;

  INSERT INTO package_pricing (trainer_user_id, program_type, sessions_total, price)
  SELECT target_trainer_id, defaults.program_type, defaults.sessions_total, defaults.price
  FROM (VALUES
    ('one_on_one', 1, 380.00),
    ('one_on_one', 4, 1520.00),
    ('one_on_one', 8, 3040.00),
    ('one_on_one', 12, 4200.00),
    ('one_on_one', 16, 5600.00),
    ('group', 1, 250.00),
    ('group', 4, 1000.00),
    ('group', 8, 2000.00),
    ('group', 12, 3000.00),
    ('group', 16, 4000.00)
  ) AS defaults(program_type, sessions_total, price)
  ON CONFLICT DO NOTHING;
END $$ LANGUAGE plpgsql;

-- The marker is set by the trigger, after both seeders have run ---------------

-- Not inside either seeder: the trigger calls them one after the other, so the
-- first to set it would make the second skip its own work.
CREATE OR REPLACE FUNCTION trainer_users_seed_scheduling()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM seed_trainer_scheduling(NEW.id);
  PERFORM seed_trainer_catalogue(NEW.id);
  UPDATE trainer_users SET defaults_seeded_at = NOW() WHERE id = NEW.id;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
