ALTER TABLE clients
ADD COLUMN IF NOT EXISTS preferred_schedule JSONB NOT NULL DEFAULT '{}'::jsonb;
