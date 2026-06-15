ALTER TABLE clients
  ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN archived_at TIMESTAMPTZ;

ALTER TABLE clients
  ADD CONSTRAINT clients_archive_state_check
    CHECK (
      (is_active AND archived_at IS NULL)
      OR (NOT is_active AND archived_at IS NOT NULL)
    );

CREATE INDEX idx_clients_active_created
  ON clients (is_active, created_at DESC, id DESC);

CREATE INDEX idx_clients_search
  ON clients (LOWER(name), LOWER(COALESCE(email, '')));
