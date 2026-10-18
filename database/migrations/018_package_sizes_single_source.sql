-- SET-03: packages still carried its own copy of the allowed size list, so a
-- size added to package_sizes could be priced but never sold. Replace the
-- hardcoded CHECK with a foreign key, leaving package_sizes as the only source.

ALTER TABLE packages
  DROP CONSTRAINT IF EXISTS packages_sessions_total_check;

-- Any size already sold must exist in package_sizes before the key is added.
INSERT INTO package_sizes (sessions_total)
SELECT DISTINCT sessions_total FROM packages
ON CONFLICT (sessions_total) DO NOTHING;

-- No ON DELETE action: the default RESTRICT is what protects history. A size
-- that packages were sold at cannot be removed from the catalogue.
ALTER TABLE packages
  ADD CONSTRAINT packages_sessions_total_fkey
    FOREIGN KEY (sessions_total) REFERENCES package_sizes (sessions_total);
