BEGIN;

CREATE TABLE IF NOT EXISTS package_pricing (
  id BIGSERIAL PRIMARY KEY,
  program_type TEXT NOT NULL CHECK (program_type IN ('one_on_one', 'group')),
  sessions_total INT NOT NULL CHECK (sessions_total IN (1, 4, 8, 12, 16)),
  price NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  UNIQUE (program_type, sessions_total)
);

INSERT INTO package_pricing (program_type, sessions_total, price)
VALUES
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
ON CONFLICT (program_type, sessions_total) DO UPDATE
SET price = EXCLUDED.price;

COMMIT;

