-- AUTH-04: sessions_no_overlap (migration 019) excluded ANY two non-cancelled
-- sessions whose times overlap, with no trainer dimension. Once each trainer
-- owns their own clients that is wrong: two trainers working at 09:00 is
-- normal, and the database was rejecting the second one. The overlap rule is
-- per trainer. A single trainer still cannot double-book themselves.

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS trainer_user_id BIGINT REFERENCES trainer_users(id);

-- A session belongs to whoever owns the people in it. Every attendee of an
-- existing session shares one owner, because before this release every client
-- did.
UPDATE sessions session
SET trainer_user_id = owner.trainer_user_id
FROM (
  SELECT DISTINCT ON (attendance.session_id)
    attendance.session_id,
    client.trainer_user_id
  FROM session_attendance attendance
  JOIN clients client ON client.id = attendance.client_id
  ORDER BY attendance.session_id, attendance.id
) owner
WHERE owner.session_id = session.id
  AND session.trainer_user_id IS NULL;

-- A session with no attendance left has nobody to inherit from, so it falls
-- back to the same owner migration 021 chose for the clients.
DO $$
DECLARE
  owner_id BIGINT;
BEGIN
  IF EXISTS (SELECT 1 FROM sessions WHERE trainer_user_id IS NULL) THEN
    SELECT id INTO owner_id FROM trainer_users WHERE role = 'admin' ORDER BY id LIMIT 1;
    IF owner_id IS NULL THEN
      SELECT id INTO owner_id FROM trainer_users ORDER BY id LIMIT 1;
    END IF;
    IF owner_id IS NULL THEN
      RAISE EXCEPTION 'Cannot assign session ownership: there are sessions but no trainer_users row. Sign in once to create the bootstrap trainer, then run migrations again.';
    END IF;
    UPDATE sessions SET trainer_user_id = owner_id WHERE trainer_user_id IS NULL;
  END IF;
END $$;

ALTER TABLE sessions ALTER COLUMN trainer_user_id SET NOT NULL;

-- Dropped and replaced in one statement pair inside one migration, which the
-- runner wraps in a transaction, so there is no moment with no overlap rule
-- at all.
ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_no_overlap;

ALTER TABLE sessions
  ADD CONSTRAINT sessions_no_overlap
  EXCLUDE USING gist (
    -- btree_gist, installed by 019, is what lets an equality operator on a
    -- scalar sit beside a range overlap in one exclusion constraint.
    trainer_user_id WITH =,
    tsrange(
      session_date + start_time,
      session_date + start_time + make_interval(mins => duration_minutes),
      '[)'
    ) WITH &&
  )
  -- Cancelled sessions still free their slot, exactly as before.
  WHERE (status <> 'cancelled');

CREATE INDEX IF NOT EXISTS idx_sessions_trainer_date
  ON sessions (trainer_user_id, session_date);

-- The session's owner is derived from its people, so it must not be possible
-- to put one trainer's client into another trainer's session -- by a direct
-- insert, or by the group-session merge picking the wrong session.
CREATE OR REPLACE FUNCTION session_attendance_owner_matches()
RETURNS trigger AS $$
DECLARE
  session_owner BIGINT;
  client_owner BIGINT;
BEGIN
  SELECT trainer_user_id INTO session_owner FROM sessions WHERE id = NEW.session_id;
  SELECT trainer_user_id INTO client_owner FROM clients WHERE id = NEW.client_id;
  IF session_owner IS DISTINCT FROM client_owner THEN
    RAISE EXCEPTION
      'Client % belongs to trainer %, but session % belongs to trainer %',
      NEW.client_id, client_owner, NEW.session_id, session_owner
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS session_attendance_owner_matches ON session_attendance;

CREATE TRIGGER session_attendance_owner_matches
  BEFORE INSERT OR UPDATE OF session_id, client_id ON session_attendance
  FOR EACH ROW EXECUTE FUNCTION session_attendance_owner_matches();
