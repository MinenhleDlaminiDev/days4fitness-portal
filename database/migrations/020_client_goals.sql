-- What each client is working towards. A goal is a line of plain words, so the
-- trainer can see why someone is here without opening their head.
--
-- There is no status column on purpose: a goal is being worked on until
-- achieved_at is set. One field cannot disagree with another that does not
-- exist.
CREATE TABLE IF NOT EXISTS client_goals (
  id BIGSERIAL PRIMARY KEY,
  client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  goal TEXT NOT NULL,
  target_date DATE,
  achieved_at DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT client_goals_goal_length_check
    CHECK (char_length(btrim(goal)) BETWEEN 1 AND 200)
);

-- The profile reads a client's goals with the unachieved ones first, newest
-- first within each group, and the session card wants only the first of those.
CREATE INDEX IF NOT EXISTS idx_client_goals_client_order
  ON client_goals (client_id, (achieved_at IS NOT NULL), created_at DESC, id DESC);
