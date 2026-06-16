ALTER TABLE package_payments
  DROP CONSTRAINT package_payments_method_check;

ALTER TABLE package_payments
  ADD CONSTRAINT package_payments_method_check
    CHECK (method IN ('cash', 'eft', 'card', 'legacy'));

ALTER TABLE package_payments
  DISABLE TRIGGER package_payments_immutable;

UPDATE package_payments
SET method = 'legacy'
WHERE reference = 'Migrated paid package'
  AND notes = 'Created automatically from the legacy paid flag';

ALTER TABLE package_payments
  ENABLE TRIGGER package_payments_immutable;

ALTER TABLE packages
  ADD CONSTRAINT packages_exact_two_month_expiry_check
    CHECK (expiry_date = (purchase_date + INTERVAL '2 months')::date)
    NOT VALID;
