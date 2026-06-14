ALTER TABLE recurring_booking_requests
  ADD CONSTRAINT recurring_booking_requests_identity_unique
    UNIQUE (id, client_id, package_id, day_of_week, start_time);

ALTER TABLE approved_recurring_bookings
  ADD CONSTRAINT approved_recurring_bookings_request_identity_fkey
    FOREIGN KEY (request_id, client_id, package_id, day_of_week, start_time)
    REFERENCES recurring_booking_requests (id, client_id, package_id, day_of_week, start_time);

CREATE OR REPLACE FUNCTION enforce_session_attendance_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  target_capacity INT;
  target_program_id BIGINT;
  package_program_id BIGINT;
  attendee_count INT;
BEGIN
  SELECT capacity, program_id
  INTO target_capacity, target_program_id
  FROM sessions
  WHERE id = NEW.session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session % does not exist', NEW.session_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  SELECT program_id
  INTO package_program_id
  FROM packages
  WHERE id = NEW.package_id
    AND client_id = NEW.client_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Package % does not belong to client %', NEW.package_id, NEW.client_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF package_program_id <> target_program_id THEN
    RAISE EXCEPTION 'Package program does not match session program'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT COUNT(*)::INT
  INTO attendee_count
  FROM session_attendance
  WHERE session_id = NEW.session_id
    AND id IS DISTINCT FROM NEW.id
    AND status <> 'cancelled';

  IF NEW.status <> 'cancelled' AND attendee_count >= target_capacity THEN
    RAISE EXCEPTION 'Session capacity of % has been reached', target_capacity
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER session_attendance_integrity_trigger
BEFORE INSERT OR UPDATE OF session_id, client_id, package_id, status
ON session_attendance
FOR EACH ROW
EXECUTE FUNCTION enforce_session_attendance_integrity();
