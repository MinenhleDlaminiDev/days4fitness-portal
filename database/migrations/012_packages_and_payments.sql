CREATE TABLE package_payments (
  id BIGSERIAL PRIMARY KEY,
  package_id BIGINT NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
  amount NUMERIC(10,2) NOT NULL CHECK (amount <> 0),
  payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  method TEXT NOT NULL CHECK (method IN ('cash', 'eft', 'card')),
  reference TEXT,
  notes TEXT,
  entry_type TEXT NOT NULL DEFAULT 'payment'
    CHECK (entry_type IN ('payment', 'reversal')),
  reverses_payment_id BIGINT UNIQUE REFERENCES package_payments(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (entry_type = 'payment' AND amount > 0 AND reverses_payment_id IS NULL)
    OR
    (entry_type = 'reversal' AND amount < 0 AND reverses_payment_id IS NOT NULL)
  )
);

CREATE INDEX idx_package_payments_package_date
  ON package_payments (package_id, payment_date DESC, id DESC);

INSERT INTO package_payments (
  package_id,
  amount,
  payment_date,
  method,
  reference,
  notes
)
SELECT
  package.id,
  package.price,
  package.purchase_date,
  'eft',
  'Migrated paid package',
  'Created automatically from the legacy paid flag'
FROM packages package
WHERE package.paid = true
  AND NOT EXISTS (
    SELECT 1
    FROM package_payments payment
    WHERE payment.package_id = package.id
  );

CREATE OR REPLACE FUNCTION prevent_payment_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Payment ledger entries are immutable';
END;
$$;

CREATE TRIGGER package_payments_immutable
BEFORE UPDATE ON package_payments
FOR EACH ROW
EXECUTE FUNCTION prevent_payment_mutation();

CREATE OR REPLACE FUNCTION sync_package_paid_flag()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  target_package_id BIGINT;
BEGIN
  target_package_id := NEW.package_id;

  UPDATE packages package
  SET paid = (
    SELECT COALESCE(SUM(payment.amount), 0) >= package.price
    FROM package_payments payment
    WHERE payment.package_id = target_package_id
  )
  WHERE package.id = target_package_id;

  RETURN NEW;
END;
$$;

CREATE TRIGGER package_payments_sync_paid
AFTER INSERT ON package_payments
FOR EACH ROW
EXECUTE FUNCTION sync_package_paid_flag();
