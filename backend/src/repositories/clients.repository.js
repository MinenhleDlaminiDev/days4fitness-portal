import { pool } from "../db/client.js";

const CLIENT_SELECT_SQL = `
  SELECT
    c.id,
    c.name,
    c.phone,
    c.email,
    c.preferred_days,
    c.preferred_schedule,
    c.created_at,
    latest_package.sessions_total,
    latest_package.sessions_used,
    latest_package.paid,
    latest_package.purchase_date::text AS purchase_date,
    latest_package.expiry_date::text AS expiry_date,
    program.name AS program_name,
    program.type AS program_type,
    COALESCE(preference_statuses.items, '[]'::jsonb) AS preference_statuses
  FROM clients c
  LEFT JOIN LATERAL (
    SELECT pk.*
    FROM packages pk
    WHERE pk.client_id = c.id
    ORDER BY pk.created_at DESC, pk.id DESC
    LIMIT 1
  ) latest_package ON true
  LEFT JOIN programs program ON program.id = latest_package.program_id
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(
      jsonb_build_object(
        'dayOfWeek', request.day_of_week,
        'startTime', TO_CHAR(request.start_time, 'HH24:MI'),
        'status', request.status
      )
      ORDER BY request.day_of_week, request.start_time
    ) AS items
    FROM recurring_booking_requests request
    WHERE request.package_id = latest_package.id
      AND request.source = 'client_preference'
      AND request.status IN ('pending', 'approved')
  ) preference_statuses ON true
`;

const DAY_NUMBERS = {
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6
};

async function syncPendingPreferenceRequests(db, clientId, packageId, preferredSchedule) {
  await db.query(
    `DELETE FROM recurring_booking_requests
     WHERE client_id = $1
       AND package_id = $2
       AND source = 'client_preference'
       AND status = 'pending'`,
    [clientId, packageId]
  );

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
         VALUES ($1, $2, $3, $4::time, 'client_preference')
         ON CONFLICT (client_id, package_id, day_of_week, start_time)
         DO UPDATE SET
           status = 'pending',
           reviewed_at = NULL,
           updated_at = NOW()
         WHERE recurring_booking_requests.status = 'rejected'`,
        [clientId, packageId, DAY_NUMBERS[day], slot]
      );
    }
  }
}

export function createClientsRepository(dbPool = pool) {
  return {
    async findAll() {
      const result = await dbPool.query(`${CLIENT_SELECT_SQL} ORDER BY c.created_at DESC`);
      return result.rows;
    },

    async findById(id, db = dbPool) {
      const result = await db.query(`${CLIENT_SELECT_SQL} WHERE c.id = $1`, [id]);
      return result.rows[0] || null;
    },

    async createWithPackage(clientData, packageData) {
      const db = await dbPool.connect();
      try {
        await db.query("BEGIN");

        const clientResult = await db.query(
          `INSERT INTO clients (name, phone, email, preferred_days, preferred_schedule)
           VALUES ($1, $2, $3, $4, $5::jsonb)
           RETURNING id`,
          [
            clientData.name,
            clientData.phone,
            clientData.email,
            clientData.preferredDays,
            JSON.stringify(clientData.preferredSchedule)
          ]
        );
        const clientId = clientResult.rows[0].id;

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
          [packageData.programType, packageData.packageSize]
        );

        if (!programResult.rows[0] || !priceResult.rows[0]) {
          const error = new Error("Package configuration is missing");
          error.code = "PACKAGE_CONFIGURATION_MISSING";
          throw error;
        }

        const packageResult = await db.query(
          `INSERT INTO packages (
             client_id,
             program_id,
             sessions_total,
             sessions_used,
             price,
             paid,
             purchase_date,
             expiry_date
           )
           VALUES (
             $1,
             $2,
             $3,
             0,
             $4,
             $5,
             $6::date,
             ($6::date + ($7::int * INTERVAL '1 month'))::date
           )
           RETURNING id`,
          [
            clientId,
            programResult.rows[0].id,
            packageData.packageSize,
            priceResult.rows[0].price,
            packageData.paid,
            packageData.purchaseDate,
            packageData.expiryMonths
          ]
        );

        await syncPendingPreferenceRequests(
          db,
          clientId,
          packageResult.rows[0].id,
          clientData.preferredSchedule
        );

        const savedClient = await this.findById(clientId, db);
        await db.query("COMMIT");
        return savedClient;
      } catch (error) {
        await db.query("ROLLBACK");
        throw error;
      } finally {
        db.release();
      }
    },

    async updatePreferences(id, preferredDays, preferredSchedule) {
      const db = await dbPool.connect();
      try {
        await db.query("BEGIN");
        const updateResult = await db.query(
          `UPDATE clients
           SET preferred_days = $2, preferred_schedule = $3::jsonb
           WHERE id = $1
           RETURNING id`,
          [id, preferredDays, JSON.stringify(preferredSchedule)]
        );
        if (!updateResult.rows[0]) {
          await db.query("ROLLBACK");
          return null;
        }

        const packageResult = await db.query(
          `SELECT id
           FROM packages
           WHERE client_id = $1
           ORDER BY created_at DESC, id DESC
           LIMIT 1`,
          [id]
        );
        if (!packageResult.rows[0]) {
          const error = new Error("Client package is missing");
          error.code = "PACKAGE_CONFIGURATION_MISSING";
          throw error;
        }

        await syncPendingPreferenceRequests(
          db,
          id,
          packageResult.rows[0].id,
          preferredSchedule
        );
        const savedClient = await this.findById(id, db);
        await db.query("COMMIT");
        return savedClient;
      } catch (error) {
        await db.query("ROLLBACK");
        throw error;
      } finally {
        db.release();
      }
    }
  };
}

export const clientsRepository = createClientsRepository();
