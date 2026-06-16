ALTER TABLE package_payments
  DISABLE TRIGGER package_payments_immutable;

UPDATE package_payments
SET method = 'legacy'
WHERE reference = 'Migrated paid package'
  AND notes = 'Created automatically from the legacy paid flag'
  AND method <> 'legacy';

ALTER TABLE package_payments
  ENABLE TRIGGER package_payments_immutable;
