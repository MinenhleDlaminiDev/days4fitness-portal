-- AUTH-03: each trainer keeps their own client list.
--
-- Ownership is modelled ONCE, here on clients. packages, payments, sessions
-- and client_goals are all reached through the client, so they get no owner
-- column of their own and there is a single place ownership can be wrong.

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS trainer_user_id BIGINT REFERENCES trainer_users(id);

-- Existing clients belong to the business that already had them, so they are
-- assigned to the first admin. trainer_users is seeded on first sign-in rather
-- than by a migration, so a database can legitimately have clients and no
-- trainer yet -- fail loudly in that case rather than silently leaving rows
-- unowned, which would then fail the NOT NULL below with a confusing error.
DO $$
DECLARE
  owner_id BIGINT;
BEGIN
  SELECT id INTO owner_id FROM trainer_users WHERE role = 'admin' ORDER BY id LIMIT 1;
  IF owner_id IS NULL THEN
    SELECT id INTO owner_id FROM trainer_users ORDER BY id LIMIT 1;
  END IF;

  IF owner_id IS NULL AND EXISTS (SELECT 1 FROM clients) THEN
    RAISE EXCEPTION
      'Cannot assign client ownership: there are clients but no trainer_users row. Insert a trainer_users row for whoever owns them, then deploy again. Signing in cannot create one first: migrations now run before the server listens.';
  END IF;

  UPDATE clients SET trainer_user_id = owner_id WHERE trainer_user_id IS NULL;
END $$;

ALTER TABLE clients
  ALTER COLUMN trainer_user_id SET NOT NULL;

-- Every scoped read filters on this column, so it carries the index rather
-- than relying on the primary key.
CREATE INDEX IF NOT EXISTS idx_clients_trainer_user
  ON clients (trainer_user_id, is_active);
