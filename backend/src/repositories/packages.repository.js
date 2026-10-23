import { pool } from "../db/client.js";
import { env } from "../config/env.js";
import { requireScope } from "../lib/ownership.js";

// SCH-04: read off the pool, so the connection carries the server's zone.
// The business day comes from the timestamp instead, with the zone passed in.
const packageFinancialSelect = (today) => `
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
      WHEN ${today} > package.expiry_date THEN 'expired'
      WHEN package.sessions_used >= package.sessions_total THEN 'exhausted'
      WHEN ${today} < package.purchase_date THEN 'upcoming'
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

export function createPackagesRepository(
  dbPool = pool,
  { businessTimezone = env.businessTimezone } = {}
) {
  return {
    async clientExists(clientId, scope) {
      const result = await dbPool.query(
        `SELECT EXISTS (
           SELECT 1 FROM clients
           WHERE id = $1 AND ($2::bigint IS NULL OR trainer_user_id = $2)
         ) AS exists`,
        [clientId, requireScope(scope)]
      );
      return result.rows[0].exists;
    },

    /** The trainer who owns a client, or null if not this caller's to see. */
    async clientOwner(clientId, scope) {
      const result = await dbPool.query(
        `SELECT trainer_user_id
         FROM clients
         WHERE id = $1 AND ($2::bigint IS NULL OR trainer_user_id = $2)`,
        [clientId, requireScope(scope)]
      );
      return result.rows[0]?.trainer_user_id ?? null;
    },

    async findForClient(clientId) {
      const packagesResult = await dbPool.query(
        `${packageFinancialSelect("(CURRENT_TIMESTAMP AT TIME ZONE $2)::date")}
         WHERE package.client_id = $1
         ORDER BY package.created_at DESC, package.id DESC`,
        [clientId, businessTimezone]
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
        // SCH-04: the renewal check below compares against CURRENT_DATE. On
        // the server's UTC day a package that expired today still read as
        // unexpired, so the renewal was refused outright with
        // PACKAGE_STILL_ACTIVE. SET-05 only changed the expiry written.
        await db.query("SELECT set_config('TimeZone', $1, true)", [businessTimezone]);
        const clientResult = await db.query(
          "SELECT id, preferred_schedule, trainer_user_id FROM clients WHERE id = $1 FOR UPDATE",
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
        // AUTH-10: read off the client row already locked above, so a renewal
        // takes the owning trainer's program and price rather than anyone
        // else's. The same rule as the session length and the expiry window.
        const ownerTrainerId = clientResult.rows[0].trainer_user_id;
        const programResult = await db.query(
          `SELECT id
           FROM programs
           WHERE LOWER(name) = LOWER($1) AND type = $2 AND trainer_user_id = $3
           LIMIT 1`,
          [packageData.programName, packageData.programType, ownerTrainerId]
        );
        const priceResult = await db.query(
          `SELECT price
           FROM package_pricing
           WHERE program_type = $1 AND sessions_total = $2 AND trainer_user_id = $3
           LIMIT 1`,
          [packageData.programType, packageData.sessionsTotal, ownerTrainerId]
        );
        if (!programResult.rows[0] || !priceResult.rows[0]) {
          const error = new Error("Package configuration is missing");
          error.code = "PACKAGE_CONFIGURATION_MISSING";
          throw error;
        }
        // SET-05: the expiry window is the owning trainer's, read in the same
        // statement that does the insert. packages_enforce_configured_expiry
        // reads the same row from the same snapshot, so the date written and
        // the date demanded cannot disagree. Passing a number in from the
        // service's settings cache would leave a window where they do.
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
           SELECT
             $1::bigint,
             $2::bigint,
             $3::int,
             $4::numeric,
             false,
             $5::date,
             ($5::date + make_interval(months => settings.package_expiry_months))::date
           FROM clients client
           JOIN scheduling_settings settings
             ON settings.trainer_user_id = client.trainer_user_id
           WHERE client.id = $1
           RETURNING id`,
          [
            clientId,
            programResult.rows[0].id,
            packageData.sessionsTotal,
            priceResult.rows[0].price,
            packageData.purchaseDate
          ]
        );
        if (!result.rows[0]) {
          // The join found no settings row for the owning trainer, so the
          // insert matched nothing and wrote nothing. The trigger would have
          // raised for the same reason had a row been written; say so here
          // rather than returning a package id that does not exist.
          const error = new Error("Package configuration is missing");
          error.code = "PACKAGE_CONFIGURATION_MISSING";
          throw error;
        }
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

    async addPayment(packageId, paymentData, scope) {
      const db = await dbPool.connect();
      try {
        await db.query("BEGIN");
        const packageResult = await db.query(
          `SELECT package.id, package.price
           FROM packages package
           JOIN clients client ON client.id = package.client_id
           WHERE package.id = $1
             AND ($2::bigint IS NULL OR client.trainer_user_id = $2)
           FOR UPDATE OF package`,
          [packageId, requireScope(scope)]
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

    async reversePayment(paymentId, reversalData, scope) {
      const db = await dbPool.connect();
      try {
        await db.query("BEGIN");
        const paymentResult = await db.query(
          `SELECT payment.*
           FROM package_payments payment
           JOIN packages package ON package.id = payment.package_id
           JOIN clients client ON client.id = package.client_id
           WHERE payment.id = $1
             AND ($2::bigint IS NULL OR client.trainer_user_id = $2)
           FOR UPDATE OF package`,
          [paymentId, requireScope(scope)]
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
