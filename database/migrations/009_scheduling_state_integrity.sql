ALTER TABLE session_attendance
  ADD CONSTRAINT session_attendance_credit_status_check
    CHECK (
      (status IN ('completed', 'no_show') AND credit_consumed)
      OR (status IN ('scheduled', 'cancelled') AND NOT credit_consumed)
    );

CREATE OR REPLACE FUNCTION enforce_approved_booking_request_status()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  request_status TEXT;
BEGIN
  IF NEW.request_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT status
  INTO request_status
  FROM recurring_booking_requests
  WHERE id = NEW.request_id
  FOR KEY SHARE;

  IF request_status IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'Recurring booking request must be approved first'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER approved_booking_request_status_trigger
BEFORE INSERT OR UPDATE OF request_id
ON approved_recurring_bookings
FOR EACH ROW
EXECUTE FUNCTION enforce_approved_booking_request_status();

CREATE OR REPLACE FUNCTION prevent_approved_request_reversal()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'approved'
    AND NEW.status <> 'approved'
    AND EXISTS (
      SELECT 1
      FROM approved_recurring_bookings
      WHERE request_id = NEW.id
    )
  THEN
    RAISE EXCEPTION 'Approved request cannot change status while a recurring booking exists'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER approved_request_reversal_trigger
BEFORE UPDATE OF status
ON recurring_booking_requests
FOR EACH ROW
EXECUTE FUNCTION prevent_approved_request_reversal();
