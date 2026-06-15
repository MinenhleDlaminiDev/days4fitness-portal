ALTER TABLE session_attendance
  ADD COLUMN rescheduled_from_attendance_id BIGINT;

UPDATE session_attendance replacement_attendance
SET rescheduled_from_attendance_id = original_attendance.id
FROM sessions replacement_session
JOIN session_attendance original_attendance
  ON original_attendance.session_id = replacement_session.rescheduled_from_session_id
WHERE replacement_attendance.session_id = replacement_session.id
  AND replacement_session.rescheduled_from_session_id IS NOT NULL
  AND replacement_attendance.client_id = original_attendance.client_id
  AND replacement_attendance.package_id = original_attendance.package_id;

ALTER TABLE session_attendance
  ADD CONSTRAINT session_attendance_rescheduled_from_fkey
    FOREIGN KEY (rescheduled_from_attendance_id)
    REFERENCES session_attendance(id)
    ON DELETE SET NULL,
  ADD CONSTRAINT session_attendance_not_self_rescheduled_check
    CHECK (
      rescheduled_from_attendance_id IS NULL
      OR rescheduled_from_attendance_id <> id
    );

CREATE UNIQUE INDEX idx_session_attendance_rescheduled_from_unique
  ON session_attendance (rescheduled_from_attendance_id)
  WHERE rescheduled_from_attendance_id IS NOT NULL;

DROP INDEX IF EXISTS idx_sessions_rescheduled_from_unique;

ALTER TABLE sessions
  DROP CONSTRAINT IF EXISTS sessions_not_self_rescheduled_check,
  DROP CONSTRAINT IF EXISTS sessions_rescheduled_from_fkey,
  DROP COLUMN rescheduled_from_session_id;
