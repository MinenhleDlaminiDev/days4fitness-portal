ALTER TABLE approved_recurring_bookings
  ADD CONSTRAINT approved_recurring_bookings_attendance_identity_unique
    UNIQUE (id, client_id, package_id);

ALTER TABLE session_attendance
  ADD CONSTRAINT session_attendance_recurring_booking_identity_fkey
    FOREIGN KEY (recurring_booking_id, client_id, package_id)
    REFERENCES approved_recurring_bookings (id, client_id, package_id);

CREATE OR REPLACE FUNCTION enforce_session_update_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  active_attendee_count INT;
BEGIN
  SELECT COUNT(*)::INT
  INTO active_attendee_count
  FROM session_attendance
  WHERE session_id = NEW.id
    AND status <> 'cancelled';

  IF NEW.capacity < active_attendee_count THEN
    RAISE EXCEPTION 'Session capacity cannot be lower than its active attendee count of %',
      active_attendee_count
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.program_id IS DISTINCT FROM OLD.program_id AND EXISTS (
    SELECT 1
    FROM session_attendance attendance
    JOIN packages package ON package.id = attendance.package_id
    WHERE attendance.session_id = NEW.id
      AND package.program_id <> NEW.program_id
  ) THEN
    RAISE EXCEPTION 'Session program cannot conflict with existing attendance packages'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER session_update_integrity_trigger
BEFORE UPDATE OF capacity, program_id, session_type
ON sessions
FOR EACH ROW
EXECUTE FUNCTION enforce_session_update_integrity();
