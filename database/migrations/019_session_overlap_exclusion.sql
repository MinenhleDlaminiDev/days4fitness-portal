-- SCH-03: idx_sessions_active_slot only caught two sessions starting at the
-- same minute. That was equivalent to overlap detection while every session
-- was 60 minutes on an hourly grid, but session length is configurable now.
-- Replace it with a real range exclusion so no insert can overlap, whatever
-- the configured length.

CREATE EXTENSION IF NOT EXISTS btree_gist;

DROP INDEX IF EXISTS idx_sessions_active_slot;

ALTER TABLE sessions
  ADD CONSTRAINT sessions_no_overlap
  EXCLUDE USING gist (
    tsrange(
      session_date + start_time,
      session_date + start_time + make_interval(mins => duration_minutes),
      '[)'
    ) WITH &&
  )
  -- Cancelled sessions free their slot, exactly as the old partial index did.
  WHERE (status <> 'cancelled');
