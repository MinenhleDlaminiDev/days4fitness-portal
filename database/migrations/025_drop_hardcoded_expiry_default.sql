-- SET-05: drop the hardcoded two-month expiry default.
--
-- packages.expiry_date has carried DEFAULT (CURRENT_DATE + INTERVAL '2 months')
-- since migration 001, when two months was the only expiry window there was.
-- Migration 017 made the window configurable and dropped the matching CHECK
-- constraint, but left the default behind. Migration 023 then made the window
-- per trainer.
--
-- Nothing depends on it: both paths that create a package supply expiry_date
-- explicitly. It is dead, and it is the wrong number for anyone who has changed
-- their window, so a path that forgot to supply the date would write a value
-- packages_enforce_configured_expiry rejects. Removing it means such a path
-- fails on the NOT NULL instead, naming the column that was actually missed.
--
-- expiry_date stays NOT NULL. The only change is that it no longer invents a
-- value.

ALTER TABLE packages ALTER COLUMN expiry_date DROP DEFAULT;
