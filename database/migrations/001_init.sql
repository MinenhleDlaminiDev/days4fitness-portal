BEGIN;

CREATE TABLE IF NOT EXISTS clients (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS programs (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('one_on_one', 'group')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (name, type)
);

CREATE TABLE IF NOT EXISTS packages (
  id BIGSERIAL PRIMARY KEY,
  client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  program_id BIGINT NOT NULL REFERENCES programs(id),
  sessions_total INT NOT NULL CHECK (sessions_total IN (1, 4, 8, 12, 16)),
  sessions_used INT NOT NULL DEFAULT 0 CHECK (sessions_used >= 0),
  price NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  paid BOOLEAN NOT NULL DEFAULT false,
  purchase_date DATE NOT NULL DEFAULT CURRENT_DATE,
  expiry_date DATE NOT NULL DEFAULT (CURRENT_DATE + INTERVAL '2 months'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (sessions_used <= sessions_total),
  CHECK (expiry_date >= purchase_date)
);

CREATE TABLE IF NOT EXISTS sessions (
  id BIGSERIAL PRIMARY KEY,
  package_id BIGINT NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
  client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  session_date DATE NOT NULL,
  start_time TIME NOT NULL,
  completed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (start_time >= TIME '05:00' AND start_time < TIME '20:00')
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_slot_unique
  ON sessions (session_date, start_time);

CREATE INDEX IF NOT EXISTS idx_sessions_client_date
  ON sessions (client_id, session_date);

INSERT INTO programs (name, type)
VALUES
  ('Weight Loss', 'one_on_one'),
  ('Strength Training', 'one_on_one'),
  ('Small Groups', 'group'),
  ('Sports Specific Training', 'one_on_one'),
  ('Toning & Shaping', 'group')
ON CONFLICT (name, type) DO NOTHING;

COMMIT;

