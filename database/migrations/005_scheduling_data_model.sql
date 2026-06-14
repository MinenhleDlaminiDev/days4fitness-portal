CREATE TABLE scheduling_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  group_capacity INT NOT NULL DEFAULT 8 CHECK (group_capacity > 0),
  session_duration_minutes INT NOT NULL DEFAULT 60 CHECK (session_duration_minutes = 60),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO scheduling_settings (id, group_capacity, session_duration_minutes)
VALUES (1, 8, 60);

CREATE TABLE recurring_booking_requests (
  id BIGSERIAL PRIMARY KEY,
  client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  package_id BIGINT NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 1 AND 6),
  start_time TIME NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  source TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'client_preference')),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (start_time >= TIME '05:00' AND start_time < TIME '20:00'),
  CHECK (day_of_week <> 6 OR start_time <= TIME '10:00'),
  CHECK (
    (status = 'pending' AND reviewed_at IS NULL)
    OR (status IN ('approved', 'rejected') AND reviewed_at IS NOT NULL)
  ),
  UNIQUE (client_id, package_id, day_of_week, start_time)
);

CREATE TABLE approved_recurring_bookings (
  id BIGSERIAL PRIMARY KEY,
  request_id BIGINT UNIQUE REFERENCES recurring_booking_requests(id) ON DELETE SET NULL,
  client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  package_id BIGINT NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
  program_id BIGINT NOT NULL REFERENCES programs(id),
  session_type TEXT NOT NULL CHECK (session_type IN ('one_on_one', 'group')),
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 1 AND 6),
  start_time TIME NOT NULL,
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (start_time >= TIME '05:00' AND start_time < TIME '20:00'),
  CHECK (day_of_week <> 6 OR start_time <= TIME '10:00'),
  CHECK (ends_on >= starts_on)
);

CREATE UNIQUE INDEX idx_approved_recurring_bookings_active_client_slot
  ON approved_recurring_bookings (client_id, package_id, day_of_week, start_time)
  WHERE status = 'active';

CREATE INDEX idx_recurring_booking_requests_pending
  ON recurring_booking_requests (created_at, id)
  WHERE status = 'pending';

CREATE INDEX idx_recurring_booking_requests_client
  ON recurring_booking_requests (client_id, status);

CREATE INDEX idx_approved_recurring_bookings_slot
  ON approved_recurring_bookings (day_of_week, start_time)
  WHERE status = 'active';

DROP INDEX IF EXISTS idx_sessions_slot_unique;
DROP INDEX IF EXISTS idx_sessions_client_date;

ALTER TABLE sessions
  ADD COLUMN program_id BIGINT REFERENCES programs(id),
  ADD COLUMN session_type TEXT,
  ADD COLUMN duration_minutes INT NOT NULL DEFAULT 60,
  ADD COLUMN capacity INT NOT NULL DEFAULT 1,
  ADD COLUMN status TEXT NOT NULL DEFAULT 'scheduled',
  ADD COLUMN rescheduled_from_session_id BIGINT;

UPDATE sessions session
SET
  program_id = package.program_id,
  session_type = program.type,
  capacity = CASE
    WHEN program.type = 'group' THEN settings.group_capacity
    ELSE 1
  END,
  status = CASE
    WHEN session.completed THEN 'completed'
    ELSE 'scheduled'
  END
FROM packages package
JOIN programs program ON program.id = package.program_id
CROSS JOIN scheduling_settings settings
WHERE package.id = session.package_id;

ALTER TABLE sessions
  ALTER COLUMN program_id SET NOT NULL,
  ALTER COLUMN session_type SET NOT NULL,
  ADD CONSTRAINT sessions_session_type_check
    CHECK (session_type IN ('one_on_one', 'group')),
  ADD CONSTRAINT sessions_duration_minutes_check
    CHECK (duration_minutes = 60),
  ADD CONSTRAINT sessions_capacity_check
    CHECK (
      (session_type = 'one_on_one' AND capacity = 1)
      OR (session_type = 'group' AND capacity > 0)
    ),
  ADD CONSTRAINT sessions_status_check
    CHECK (status IN ('scheduled', 'completed', 'cancelled', 'no_show')),
  ADD CONSTRAINT sessions_training_day_check
    CHECK (EXTRACT(ISODOW FROM session_date) BETWEEN 1 AND 6) NOT VALID,
  ADD CONSTRAINT sessions_saturday_hours_check
    CHECK (
      EXTRACT(ISODOW FROM session_date) <> 6
      OR start_time <= TIME '10:00'
    ) NOT VALID,
  ADD CONSTRAINT sessions_rescheduled_from_fkey
    FOREIGN KEY (rescheduled_from_session_id) REFERENCES sessions(id) ON DELETE SET NULL,
  ADD CONSTRAINT sessions_not_self_rescheduled_check
    CHECK (rescheduled_from_session_id IS NULL OR rescheduled_from_session_id <> id);

CREATE TABLE session_attendance (
  id BIGSERIAL PRIMARY KEY,
  session_id BIGINT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  package_id BIGINT NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
  recurring_booking_id BIGINT REFERENCES approved_recurring_bookings(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'completed', 'cancelled', 'no_show')),
  credit_consumed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (session_id, client_id)
);

INSERT INTO session_attendance (
  session_id,
  client_id,
  package_id,
  status,
  credit_consumed
)
SELECT
  id,
  client_id,
  package_id,
  CASE WHEN completed THEN 'completed' ELSE 'scheduled' END,
  completed
FROM sessions;

ALTER TABLE sessions
  DROP COLUMN completed,
  DROP COLUMN client_id,
  DROP COLUMN package_id;

CREATE UNIQUE INDEX idx_sessions_active_slot
  ON sessions (session_date, start_time)
  WHERE status <> 'cancelled';

CREATE UNIQUE INDEX idx_sessions_rescheduled_from_unique
  ON sessions (rescheduled_from_session_id)
  WHERE rescheduled_from_session_id IS NOT NULL;

CREATE INDEX idx_sessions_date_status
  ON sessions (session_date, status, start_time);

CREATE INDEX idx_session_attendance_client
  ON session_attendance (client_id, status, session_id);

CREATE INDEX idx_session_attendance_package
  ON session_attendance (package_id, status);

INSERT INTO recurring_booking_requests (
  client_id,
  package_id,
  day_of_week,
  start_time,
  source
)
SELECT
  client.id,
  latest_package.id,
  CASE preference.day
    WHEN 'Monday' THEN 1
    WHEN 'Tuesday' THEN 2
    WHEN 'Wednesday' THEN 3
    WHEN 'Thursday' THEN 4
    WHEN 'Friday' THEN 5
    WHEN 'Saturday' THEN 6
  END,
  preference_time.value::time,
  'client_preference'
FROM clients client
JOIN LATERAL (
  SELECT package.id
  FROM packages package
  WHERE package.client_id = client.id
  ORDER BY package.created_at DESC, package.id DESC
  LIMIT 1
) latest_package ON true
CROSS JOIN LATERAL jsonb_each(client.preferred_schedule) preference(day, times)
CROSS JOIN LATERAL jsonb_array_elements_text(preference.times) preference_time(value)
WHERE preference.day IN ('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday')
  AND preference_time.value ~ '^\d{2}:\d{2}$'
ON CONFLICT (client_id, package_id, day_of_week, start_time) DO NOTHING;
