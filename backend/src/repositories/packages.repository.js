import { pool } from "../db/client.js";

const PACKAGE_FINANCIAL_SELECT = `
  SELECT
    package.id,
    package.client_id,
    package.program_id,
    package.sessions_total,
    package.sessions_used,
    package.price,
    package.purchase_date::text,
    package.expiry_date::text,
    package.created_at,
    program.name AS program_name,
    program.type AS program_type,
    COALESCE(payment_totals.paid_amount, 0)::numeric(10,2) AS paid_amount,
    GREATEST(package.price - COALESCE(payment_totals.paid_amount, 0), 0)::numeric(10,2)
      AS outstanding_balance,
    CASE
      WHEN COALESCE(payment_totals.paid_amount, 0) >= package.price THEN 'paid'
      WHEN COALESCE(payment_totals.paid_amount, 0) > 0 THEN 'partially_paid'
      ELSE 'unpaid'
    END AS payment_status,
    CASE
      WHEN CURRENT_DATE > package.expiry_date THEN 'expired'
      WHEN package.sessions_used >= package.sessions_total THEN 'exhausted'
      WHEN CURRENT_DATE < package.purchase_date THEN 'upcoming'
      ELSE 'active'
    END AS package_status
  FROM packages package
  JOIN programs program ON program.id = package.program_id
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(payment.amount), 0) AS paid_amount
    FROM package_payments payment
    WHERE payment.package_id = package.id
  ) payment_totals ON true
`;

export function createPackagesRepository(dbPool = pool) {
  return {
    async clientExists(clientId) {
      const result = await dbPool.query(
        "SELECT EXISTS (SELECT 1 FROM clients WHERE id = $1) AS exists",
        [clientId]
      );
      return result.rows[0].exists;
    },

    async findForClient(clientId) {
      const packagesResult = await dbPool.query(
        `${PACKAGE_FINANCIAL_SELECT}
         WHERE package.client_id = $1
         ORDER BY package.created_at DESC, package.id DESC`,
        [clientId]
      );
      const packageIds = packagesResult.rows.map((row) => row.id);
      const paymentsResult =
        packageIds.length === 0
          ? { rows: [] }
          : await dbPool.query(
              `SELECT
                 payment.id,
                 payment.package_id,
                 payment.amount,
                 payment.payment_date::text,
                 payment.method,
                 payment.reference,
                 payment.notes,
                 payment.entry_type,
                 payment.reverses_payment_id,
                 payment.created_at
               FROM package_payments payment
               WHERE payment.package_id = ANY($1::bigint[])
               ORDER BY payment.payment_date DESC, payment.id DESC`,
              [packageIds]
            );
      const paymentsByPackage = new Map();
      for (const payment of paymentsResult.rows) {
        const rows = paymentsByPackage.get(payment.package_id) || [];
        rows.push(payment);
        paymentsByPackage.set(payment.package_id, rows);
      }
      return packagesResult.rows.map((row) => ({
        ...row,
        payments: paymentsByPackage.get(row.id) || []
      }));
    },

    async createForClient(clientId, packageData) {
      const db = await dbPool.connect();
      try {
        await db.query("BEGIN");
        const clientResult = await db.query(
          "SELECT id, preferred_schedule FROM clients WHERE id = $1 FOR UPDATE",
          [clientId]
        );
        if (!clientResult.rows[0]) {
          await db.query("ROLLBACK");
          return null;
        }
        const latestResult = await db.query(
          `SELECT
             packages.*,
             CURRENT_DATE <= expiry_date AS is_unexpired
           FROM packages
           WHERE client_id = $1
           ORDER BY created_at DESC, id DESC
           LIMIT 1
           FOR UPDATE`,
          [clientId]
        );
        const latest = latestResult.rows[0];
        if (
          latest &&
          latest.sessions_used < latest.sessions_total &&
          latest.is_unexpired
        ) {
          const error = new Error("The current package must expire or use all credits before renewal");
          error.code = "PACKAGE_STILL_ACTIVE";
          throw error;
        }
        const programResult = await db.query(
          `SELECT id
           FROM programs
           WHERE LOWER(name) = LOWER($1) AND type = $2
           LIMIT 1`,
          [packageData.programName, packageData.programType]
        );
        const priceResult = await db.query(
          `SELECT price
           FROM package_pricing
           WHERE program_type = $1 AND sessions_total = $2
           LIMIT 1`,
          [packageData.programType, packageData.sessionsTotal]
        );
        if (!programResult.rows[0] || !priceResult.rows[0]) {
          const error = new Error("Package configuration is missing");
          error.code = "PACKAGE_CONFIGURATION_MISSING";
          throw error;
        }
        const result = await db.query(
          `INSERT INTO packages (
             client_id,
             program_id,
             sessions_total,
             price,
             paid,
             purchase_date,
             expiry_date
           )
           VALUES (
             $1,
             $2,
             $3,
             $4,
             false,
             $5::date,
             ($5::date + INTERVAL '2 months')::date
           )
           RETURNING id`,
          [
            clientId,
            programResult.rows[0].id,
            packageData.sessionsTotal,
            priceResult.rows[0].price,
            packageData.purchaseDate
          ]
        );
        const packageId = result.rows[0].id;
        const preferredSchedule = clientResult.rows[0].preferred_schedule || {};
        for (const [day, slots] of Object.entries(preferredSchedule)) {
          for (const slot of slots) {
            await db.query(
              `INSERT INTO recurring_booking_requests (
                 client_id,
                 package_id,
                 day_of_week,
                 start_time,
                 source
               )
               VALUES (
                 $1,
                 $2,
                 CASE $3
                   WHEN 'Monday' THEN 1
                   WHEN 'Tuesday' THEN 2
                   WHEN 'Wednesday' THEN 3
                   WHEN 'Thursday' THEN 4
                   WHEN 'Friday' THEN 5
                   WHEN 'Saturday' THEN 6
                 END,
                 $4::time,
                 'client_preference'
               )`,
              [clientId, packageId, day, slot]
            );
          }
        }
        await db.query("COMMIT");
        return packageId;
      } catch (error) {
        await db.query("ROLLBACK");
        throw error;
      } finally {
        db.release();
      }
    },

    async addPayment(packageId, paymentData) {
      const db = await dbPool.connect();
      try {
        await db.query("BEGIN");
        const packageResult = await db.query(
          `SELECT id, price
           FROM packages
           WHERE id = $1
           FOR UPDATE`,
          [packageId]
        );
        const packageRow = packageResult.rows[0];
        if (!packageRow) {
          await db.query("ROLLBACK");
          return null;
        }
        const balanceResult = await db.query(
          `SELECT
             $2::numeric(10,2) >
               (package.price - COALESCE(SUM(payment.amount), 0)) AS exceeds_balance
           FROM packages package
           LEFT JOIN package_payments payment ON payment.package_id = package.id
           WHERE package.id = $1
           GROUP BY package.id, package.price`,
          [packageId, paymentData.amount]
        );
        if (balanceResult.rows[0].exceeds_balance) {
          const error = new Error("Payment amount cannot exceed the outstanding balance");
          error.code = "PAYMENT_EXCEEDS_BALANCE";
          throw error;
        }
        const result = await db.query(
          `INSERT INTO package_payments (
             package_id,
             amount,
             payment_date,
             method,
             reference,
             notes
           )
           VALUES ($1, $2, $3::date, $4, $5, $6)
           RETURNING *`,
          [
            packageId,
            paymentData.amount,
            paymentData.paymentDate,
            paymentData.method,
            paymentData.reference,
            paymentData.notes
          ]
        );
        await db.query("COMMIT");
        return result.rows[0];
      } catch (error) {
        await db.query("ROLLBACK");
        throw error;
      } finally {
        db.release();
      }
    },

    async reversePayment(paymentId, reversalData) {
      const db = await dbPool.connect();
      try {
        await db.query("BEGIN");
        const paymentResult = await db.query(
          `SELECT payment.*
           FROM package_payments payment
           JOIN packages package ON package.id = payment.package_id
           WHERE payment.id = $1
           FOR UPDATE OF package`,
          [paymentId]
        );
        const payment = paymentResult.rows[0];
        if (!payment) {
          await db.query("ROLLBACK");
          return null;
        }
        if (payment.entry_type !== "payment") {
          const error = new Error("Only payment entries can be reversed");
          error.code = "PAYMENT_NOT_REVERSIBLE";
          throw error;
        }
        const existingResult = await db.query(
          "SELECT id FROM package_payments WHERE reverses_payment_id = $1",
          [paymentId]
        );
        if (existingResult.rows[0]) {
          const error = new Error("This payment has already been reversed");
          error.code = "PAYMENT_ALREADY_REVERSED";
          throw error;
        }
        const result = await db.query(
          `INSERT INTO package_payments (
             package_id,
             amount,
             payment_date,
             method,
             reference,
             notes,
             entry_type,
             reverses_payment_id
           )
           VALUES ($1, $2, $3::date, $4, $5, $6, 'reversal', $7)
           RETURNING *`,
          [
            payment.package_id,
            -Number(payment.amount),
            reversalData.paymentDate,
            payment.method,
            reversalData.reference,
            reversalData.notes,
            paymentId
          ]
        );
        await db.query("COMMIT");
        return result.rows[0];
      } catch (error) {
        await db.query("ROLLBACK");
        throw error;
      } finally {
        db.release();
      }
    }
  };
}

export const packagesRepository = createPackagesRepository();
