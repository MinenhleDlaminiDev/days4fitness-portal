-- AUTH-10: prices, programs and package sizes belong to the trainer.
--
-- These are independent personal trainers sharing software, not staff at one
-- company. They charge differently and offer different things, so none of the
-- catalogue is shared. package_pricing was UNIQUE (program_type,
-- sessions_total) and programs was UNIQUE (name, type): one price list and one
-- program list for everybody.
--
-- The hard part is packages.sessions_total, which has a plain foreign key to
-- package_sizes. Once a size is keyed (trainer_user_id, sessions_total) that
-- key cannot hold, and packages must NOT grow a trainer column -- ownership
-- lives on clients and is reached through it. So the constraint is what gives
-- way: a trigger reaches the owner through clients instead, exactly as
-- packages_enforce_configured_expiry already does for the expiry window.
--
-- Unlike 023, this migration does not refuse to run on a database with no
-- trainer yet. Catalogue rows seeded by 001, 002 and 017 are defaults rather
-- than anybody's data, so with no trainer to own them they are dropped and
-- seed_trainer_catalogue() puts them back per trainer. A database with no
-- trainer_users row can have no clients either (021 made that column NOT
-- NULL), so nothing real can be lost here.

-- Programs -----------------------------------------------------------------

ALTER TABLE programs
  ADD COLUMN IF NOT EXISTS trainer_user_id BIGINT REFERENCES trainer_users(id);

-- Must go before the copies below: every trainer gets the same names.
ALTER TABLE programs DROP CONSTRAINT IF EXISTS programs_name_type_key;

DO $$
DECLARE
  owner_id BIGINT;
BEGIN
  SELECT id INTO owner_id FROM trainer_users WHERE role = 'admin' ORDER BY id LIMIT 1;
  IF owner_id IS NULL THEN
    SELECT id INTO owner_id FROM trainer_users ORDER BY id LIMIT 1;
  END IF;

  IF owner_id IS NULL THEN
    -- Nothing but the seeded defaults can exist yet. The trigger reseeds them.
    DELETE FROM programs;
  ELSE
    UPDATE programs SET trainer_user_id = owner_id WHERE trainer_user_id IS NULL;

    -- Every other trainer gets their own copy of the same starting list.
    INSERT INTO programs (name, type, trainer_user_id)
    SELECT source.name, source.type, trainer.id
    FROM programs source
    CROSS JOIN trainer_users trainer
    WHERE source.trainer_user_id = owner_id
      AND trainer.id <> owner_id
      AND NOT EXISTS (
        SELECT 1
        FROM programs existing
        WHERE existing.trainer_user_id = trainer.id
          AND existing.name = source.name
          AND existing.type = source.type
      );
  END IF;
END $$;

-- Existing packages and sessions still point at the original rows, which now
-- belong to one trainer. Move each to its own owner's copy of the same program
-- so no record references another trainer's catalogue. Matched on (name, type)
-- because that is what the copies above preserve.
UPDATE packages target
SET program_id = mine.id
FROM clients client, programs theirs, programs mine
WHERE client.id = target.client_id
  AND theirs.id = target.program_id
  AND theirs.trainer_user_id <> client.trainer_user_id
  AND mine.trainer_user_id = client.trainer_user_id
  AND mine.name = theirs.name
  AND mine.type = theirs.type;

UPDATE sessions target
SET program_id = mine.id
FROM programs theirs, programs mine
WHERE theirs.id = target.program_id
  AND theirs.trainer_user_id <> target.trainer_user_id
  AND mine.trainer_user_id = target.trainer_user_id
  AND mine.name = theirs.name
  AND mine.type = theirs.type;

UPDATE approved_recurring_bookings target
SET program_id = mine.id
FROM clients client, programs theirs, programs mine
WHERE client.id = target.client_id
  AND theirs.id = target.program_id
  AND theirs.trainer_user_id <> client.trainer_user_id
  AND mine.trainer_user_id = client.trainer_user_id
  AND mine.name = theirs.name
  AND mine.type = theirs.type;

ALTER TABLE programs ALTER COLUMN trainer_user_id SET NOT NULL;

ALTER TABLE programs DROP CONSTRAINT IF EXISTS programs_owner_name_type_key;
ALTER TABLE programs
  ADD CONSTRAINT programs_owner_name_type_key UNIQUE (trainer_user_id, name, type);

CREATE INDEX IF NOT EXISTS idx_programs_trainer ON programs (trainer_user_id);

-- programs_id_type_unique is untouched on purpose: sessions and
-- approved_recurring_bookings hold composite keys to (id, type), and (id, type)
-- stays unique because id is still the primary key.

-- Package sizes ------------------------------------------------------------

-- Both foreign keys into package_sizes have to go before its key changes.
-- package_pricing gets a composite one back further down. packages does not:
-- it has no trainer column and must not gain one, so it gets a trigger.
ALTER TABLE package_pricing DROP CONSTRAINT IF EXISTS package_pricing_sessions_total_fkey;
ALTER TABLE packages DROP CONSTRAINT IF EXISTS packages_sessions_total_fkey;

ALTER TABLE package_sizes
  ADD COLUMN IF NOT EXISTS trainer_user_id BIGINT REFERENCES trainer_users(id);

ALTER TABLE package_sizes DROP CONSTRAINT IF EXISTS package_sizes_pkey;

DO $$
DECLARE
  owner_id BIGINT;
BEGIN
  SELECT id INTO owner_id FROM trainer_users WHERE role = 'admin' ORDER BY id LIMIT 1;
  IF owner_id IS NULL THEN
    SELECT id INTO owner_id FROM trainer_users ORDER BY id LIMIT 1;
  END IF;

  IF owner_id IS NULL THEN
    DELETE FROM package_sizes;
  ELSE
    UPDATE package_sizes SET trainer_user_id = owner_id WHERE trainer_user_id IS NULL;

    INSERT INTO package_sizes (sessions_total, trainer_user_id)
    SELECT source.sessions_total, trainer.id
    FROM package_sizes source
    CROSS JOIN trainer_users trainer
    WHERE source.trainer_user_id = owner_id
      AND trainer.id <> owner_id
      AND NOT EXISTS (
        SELECT 1
        FROM package_sizes existing
        WHERE existing.trainer_user_id = trainer.id
          AND existing.sessions_total = source.sessions_total
      );
  END IF;
END $$;

ALTER TABLE package_sizes ALTER COLUMN trainer_user_id SET NOT NULL;
ALTER TABLE package_sizes
  ADD CONSTRAINT package_sizes_pkey PRIMARY KEY (trainer_user_id, sessions_total);

-- Prices -------------------------------------------------------------------

ALTER TABLE package_pricing
  ADD COLUMN IF NOT EXISTS trainer_user_id BIGINT REFERENCES trainer_users(id);

ALTER TABLE package_pricing
  DROP CONSTRAINT IF EXISTS package_pricing_program_type_sessions_total_key;

DO $$
DECLARE
  owner_id BIGINT;
BEGIN
  SELECT id INTO owner_id FROM trainer_users WHERE role = 'admin' ORDER BY id LIMIT 1;
  IF owner_id IS NULL THEN
    SELECT id INTO owner_id FROM trainer_users ORDER BY id LIMIT 1;
  END IF;

  IF owner_id IS NULL THEN
    DELETE FROM package_pricing;
  ELSE
    UPDATE package_pricing SET trainer_user_id = owner_id WHERE trainer_user_id IS NULL;

    INSERT INTO package_pricing (program_type, sessions_total, price, trainer_user_id)
    SELECT source.program_type, source.sessions_total, source.price, trainer.id
    FROM package_pricing source
    CROSS JOIN trainer_users trainer
    WHERE source.trainer_user_id = owner_id
      AND trainer.id <> owner_id
      AND NOT EXISTS (
        SELECT 1
        FROM package_pricing existing
        WHERE existing.trainer_user_id = trainer.id
          AND existing.program_type = source.program_type
          AND existing.sessions_total = source.sessions_total
      );
  END IF;
END $$;

ALTER TABLE package_pricing ALTER COLUMN trainer_user_id SET NOT NULL;
ALTER TABLE package_pricing DROP CONSTRAINT IF EXISTS package_pricing_pkey;
ALTER TABLE package_pricing DROP COLUMN IF EXISTS id;
ALTER TABLE package_pricing
  ADD CONSTRAINT package_pricing_pkey PRIMARY KEY (trainer_user_id, program_type, sessions_total);

-- A price may only name a size its own trainer offers. This one CAN stay a
-- foreign key, because pricing carries the trainer column.
ALTER TABLE package_pricing
  ADD CONSTRAINT package_pricing_owner_size_fkey
    FOREIGN KEY (trainer_user_id, sessions_total)
    REFERENCES package_sizes (trainer_user_id, sessions_total);

-- What replaces packages_sessions_total_fkey ---------------------------------

-- A package must name a size and a program that belong to its own client's
-- trainer. foreign_key_violation (23503) is raised deliberately: it is what the
-- dropped constraint raised, so configuration.service.js keeps translating
-- these into the messages it already has.
CREATE OR REPLACE FUNCTION packages_enforce_owner_catalogue()
RETURNS TRIGGER AS $$
DECLARE
  owner_id BIGINT;
BEGIN
  SELECT trainer_user_id INTO owner_id FROM clients WHERE id = NEW.client_id;
  IF owner_id IS NULL THEN
    RAISE EXCEPTION 'Package references client % which has no owner', NEW.client_id
      USING ERRCODE = '23503';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM package_sizes
    WHERE trainer_user_id = owner_id AND sessions_total = NEW.sessions_total
  ) THEN
    RAISE EXCEPTION 'Trainer % does not offer a % session package', owner_id, NEW.sessions_total
      USING ERRCODE = '23503';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM programs WHERE id = NEW.program_id AND trainer_user_id = owner_id
  ) THEN
    RAISE EXCEPTION 'Program % does not belong to trainer %', NEW.program_id, owner_id
      USING ERRCODE = '23503';
  END IF;

  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS packages_owner_catalogue ON packages;
CREATE TRIGGER packages_owner_catalogue
  BEFORE INSERT OR UPDATE OF client_id, sessions_total, program_id ON packages
  FOR EACH ROW EXECUTE FUNCTION packages_enforce_owner_catalogue();

-- The dropped foreign key also protected history through RESTRICT: a size
-- clients had bought could not be deleted. A trigger has to do that itself.
CREATE OR REPLACE FUNCTION package_sizes_protect_sold()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM packages package
    JOIN clients client ON client.id = package.client_id
    WHERE client.trainer_user_id = OLD.trainer_user_id
      AND package.sessions_total = OLD.sessions_total
  ) THEN
    RAISE EXCEPTION 'Package size % has been sold by trainer %', OLD.sessions_total, OLD.trainer_user_id
      USING ERRCODE = '23503';
  END IF;
  RETURN OLD;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS package_sizes_protect_sold ON package_sizes;
CREATE TRIGGER package_sizes_protect_sold
  BEFORE DELETE ON package_sizes
  FOR EACH ROW EXECUTE FUNCTION package_sizes_protect_sold();

-- A session's program must belong to the trainer running it. sessions carries
-- trainer_user_id directly since AUTH-04, so this needs no join to clients.
CREATE OR REPLACE FUNCTION sessions_enforce_owner_program()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM programs
    WHERE id = NEW.program_id AND trainer_user_id = NEW.trainer_user_id
  ) THEN
    RAISE EXCEPTION 'Program % does not belong to trainer %', NEW.program_id, NEW.trainer_user_id
      USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sessions_owner_program ON sessions;
CREATE TRIGGER sessions_owner_program
  BEFORE INSERT OR UPDATE OF program_id, trainer_user_id ON sessions
  FOR EACH ROW EXECUTE FUNCTION sessions_enforce_owner_program();

-- A new trainer's starting catalogue ----------------------------------------

-- The same defaults 001, 002 and 017 seeded, now per trainer. A starting point
-- to edit, not a shared list: changing one trainer's prices cannot touch
-- another's. Paired with seed_trainer_scheduling from 023.
CREATE OR REPLACE FUNCTION seed_trainer_catalogue(target_trainer_id BIGINT)
RETURNS void AS $$
BEGIN
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

-- Every trainer who already existed, including the one the rows above were
-- assigned to, so a gap in their list is filled rather than left.
DO $$
DECLARE
  existing_trainer BIGINT;
BEGIN
  FOR existing_trainer IN SELECT id FROM trainer_users ORDER BY id LOOP
    PERFORM seed_trainer_catalogue(existing_trainer);
  END LOOP;
END $$;

-- 023 created this to seed hours and scheduling settings. Extended rather than
-- added alongside, because one trigger per table is easier to reason about and
-- a new trainer needs both or neither.
CREATE OR REPLACE FUNCTION trainer_users_seed_scheduling()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM seed_trainer_scheduling(NEW.id);
  PERFORM seed_trainer_catalogue(NEW.id);
  RETURN NEW;
END $$ LANGUAGE plpgsql;
