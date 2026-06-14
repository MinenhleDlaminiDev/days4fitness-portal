ALTER TABLE programs
  ADD CONSTRAINT programs_id_type_unique UNIQUE (id, type);

ALTER TABLE packages
  ADD CONSTRAINT packages_id_client_unique UNIQUE (id, client_id),
  ADD CONSTRAINT packages_id_client_program_unique UNIQUE (id, client_id, program_id);

ALTER TABLE recurring_booking_requests
  ADD CONSTRAINT recurring_booking_requests_package_client_fkey
    FOREIGN KEY (package_id, client_id)
    REFERENCES packages (id, client_id)
    ON DELETE CASCADE;

ALTER TABLE approved_recurring_bookings
  ADD CONSTRAINT approved_recurring_bookings_package_client_program_fkey
    FOREIGN KEY (package_id, client_id, program_id)
    REFERENCES packages (id, client_id, program_id)
    ON DELETE CASCADE,
  ADD CONSTRAINT approved_recurring_bookings_program_type_fkey
    FOREIGN KEY (program_id, session_type)
    REFERENCES programs (id, type);

ALTER TABLE sessions
  ADD CONSTRAINT sessions_program_type_fkey
    FOREIGN KEY (program_id, session_type)
    REFERENCES programs (id, type);

ALTER TABLE session_attendance
  ADD CONSTRAINT session_attendance_package_client_fkey
    FOREIGN KEY (package_id, client_id)
    REFERENCES packages (id, client_id)
    ON DELETE CASCADE;
