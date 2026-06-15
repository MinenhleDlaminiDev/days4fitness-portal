import { pool } from "../db/client.js";
import { env } from "../config/env.js";
import { allocatePackageSessions } from "./packageAllocation.repository.js";

const CLIENT_SELECT_SQL = `
  SELECT
    c.id,
    c.name,
    c.phone,
    c.email,
    c.preferred_days,
    c.preferred_schedule,
    c.is_active,
    c.archived_at,
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
      AND request.status IN ('pending', 'approved', 'rejected')
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

async function syncPreferenceRequests(db, clientId, packageId, preferredSchedule) {
  const desiredSlots = new Set(
    Object.entries(preferredSchedule).flatMap(([day, slots]) =>
      slots.map((slot) => `${DAY_NUMBERS[day]}-${slot}`)
    )
  );
  const approvedResult = await db.query(
    `SELECT
       request.id AS request_id,
       request.day_of_week,
       request.start_time::text,
       booking.id AS booking_id,
       booking.status AS booking_status
     FROM recurring_booking_requests request
     LEFT JOIN approved_recurring_bookings booking ON booking.request_id = request.id
     WHERE request.client_id = $1
       AND request.package_id = $2
       AND request.source = 'client_preference'
       AND request.status = 'approved'
     ORDER BY request.id, booking.id
     FOR UPDATE OF request`,
    [clientId, packageId]
  );
  const requestGroups = new Map();

  for (const row of approvedResult.rows) {
    const group = requestGroups.get(row.request_id) || {
      requestId: row.request_id,
      slotKey: `${row.day_of_week}-${row.start_time.slice(0, 5)}`,
      bookings: []
    };
    if (row.booking_id) {
      group.bookings.push({ id: row.booking_id, status: row.booking_status });
    }
    requestGroups.set(row.request_id, group);
  }

  for (const group of requestGroups.values()) {
    const desired = desiredSlots.has(group.slotKey);
    const activeBookings = group.bookings.filter((booking) => booking.status === "active");
    if (desired && activeBookings.length > 0) continue;

    const activeBookingIds = activeBookings.map((booking) => booking.id);
    let affectedSessionIds = [];
    if (activeBookingIds.length > 0) {
      const attendanceResult = await db.query(
        `UPDATE session_attendance attendance
         SET status = 'cancelled', credit_consumed = false, updated_at = NOW()
         FROM sessions session
         WHERE attendance.session_id = session.id
           AND attendance.recurring_booking_id = ANY($1::bigint[])
           AND attendance.status = 'scheduled'
           AND (session.session_date + session.start_time) > LOCALTIMESTAMP
         RETURNING attendance.session_id`,
        [activeBookingIds]
      );
      affectedSessionIds = [
        ...new Set(attendanceResult.rows.map((row) => row.session_id))
      ];
    }

    await db.query(
      `UPDATE approved_recurring_bookings
       SET
         status = CASE WHEN status = 'active' THEN 'cancelled' ELSE status END,
         request_id = NULL,
         updated_at = NOW()
       WHERE request_id = $1`,
      [group.requestId]
    );
    await db.query(
      `UPDATE recurring_booking_requests
       SET
         status = $2,
         reviewed_at = CASE WHEN $2 = 'pending' THEN NULL ELSE NOW() END,
         updated_at = NOW()
       WHERE id = $1`,
      [group.requestId, desired ? "pending" : "rejected"]
    );

    if (affectedSessionIds.length > 0) {
      await db.query(
        `UPDATE sessions session
         SET status = 'cancelled'
         WHERE session.id = ANY($1::bigint[])
           AND NOT EXISTS (
             SELECT 1
             FROM session_attendance attendance
             WHERE attendance.session_id = session.id
               AND attendance.status <> 'cancelled'
           )`,
        [affectedSessionIds]
      );
    }
  }

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

  await allocatePackageSessions(db, packageId);
}

export function createClientsRepository(
  dbPool = pool,
  { businessTimezone = env.businessTimezone } = {}
) {
  return {
    async findAll({ search, status, packageStatus, page, pageSize }) {
      const conditions = [];
      const values = [];
      const addValue = (value) => {
        values.push(value);
        return `$${values.length}`;
      };

      if (search) {
        const placeholder = addValue(`%${search.toLowerCase()}%`);
        conditions.push(
          `(LOWER(c.name) LIKE ${placeholder}
            OR LOWER(COALESCE(c.email, '')) LIKE ${placeholder}
            OR c.phone LIKE ${placeholder}
            OR EXISTS (
              SELECT 1
              FROM packages search_package
              JOIN programs search_program ON search_program.id = search_package.program_id
              WHERE search_package.client_id = c.id
                AND LOWER(search_program.name) LIKE ${placeholder}
            ))`
        );
      }
      if (status === "active") conditions.push("c.is_active = true");
      if (status === "archived") conditions.push("c.is_active = false");
      if (packageStatus === "active") {
        conditions.push("latest_package.expiry_date >= CURRENT_DATE");
      }
      if (packageStatus === "expired") {
        conditions.push("latest_package.expiry_date < CURRENT_DATE");
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      const countResult = await dbPool.query(
        `SELECT
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE latest_package.paid IS NOT TRUE)::int AS unpaid_total
         FROM clients c
         LEFT JOIN LATERAL (
           SELECT pk.expiry_date, pk.paid
           FROM packages pk
           WHERE pk.client_id = c.id
           ORDER BY pk.created_at DESC, pk.id DESC
           LIMIT 1
         ) latest_package ON true
         ${where}`,
        values
      );
      const limitPlaceholder = addValue(pageSize);
      const offsetPlaceholder = addValue((page - 1) * pageSize);
      const result = await dbPool.query(
        `${CLIENT_SELECT_SQL}
         ${where}
         ORDER BY c.created_at DESC, c.id DESC
         LIMIT ${limitPlaceholder}
         OFFSET ${offsetPlaceholder}`,
        values
      );
      return {
        rows: result.rows,
        total: countResult.rows[0].total,
        unpaidTotal: countResult.rows[0].unpaid_total
      };
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

        await syncPreferenceRequests(
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

    async update(id, clientData, preferences = null) {
      const db = await dbPool.connect();
      try {
        await db.query("BEGIN");
        const clientResult = await db.query(
          `SELECT id, is_active
           FROM clients
           WHERE id = $1
           FOR UPDATE`,
          [id]
        );
        if (!clientResult.rows[0]) {
          await db.query("ROLLBACK");
          return null;
        }
        if (preferences && !clientResult.rows[0].is_active) {
          const error = new Error("Archived clients cannot update preferences");
          error.code = "CLIENT_ARCHIVED";
          throw error;
        }

        await db.query(
          `UPDATE clients
           SET name = $2, phone = $3, email = $4
           WHERE id = $1`,
          [id, clientData.name, clientData.phone, clientData.email]
        );

        if (preferences) {
          await db.query("SELECT set_config('TimeZone', $1, true)", [businessTimezone]);
          await db.query(
            `UPDATE clients
             SET preferred_days = $2, preferred_schedule = $3::jsonb
             WHERE id = $1`,
            [id, preferences.preferredDays, JSON.stringify(preferences.preferredSchedule)]
          );
          const packageResult = await db.query(
            `SELECT id
             FROM packages
             WHERE client_id = $1
             ORDER BY created_at DESC, id DESC
             LIMIT 1
             FOR UPDATE`,
            [id]
          );
          if (!packageResult.rows[0]) {
            const error = new Error("Client package is missing");
            error.code = "PACKAGE_CONFIGURATION_MISSING";
            throw error;
          }
          await syncPreferenceRequests(
            db,
            id,
            packageResult.rows[0].id,
            preferences.preferredSchedule
          );
        }

        const saved = await this.findById(id, db);
        await db.query("COMMIT");
        return saved;
      } catch (error) {
        await db.query("ROLLBACK");
        throw error;
      } finally {
        db.release();
      }
    },

    async setActive(id, isActive) {
      const db = await dbPool.connect();
      try {
        await db.query("BEGIN");
        await db.query("SELECT set_config('TimeZone', $1, true)", [businessTimezone]);
        const lockedClient = await db.query(
          "SELECT id FROM clients WHERE id = $1 FOR UPDATE",
          [id]
        );
        if (!lockedClient.rows[0]) {
          await db.query("ROLLBACK");
          return null;
        }
        const result = await db.query(
          `UPDATE clients
           SET
             is_active = $2,
             archived_at = CASE WHEN $2 THEN NULL ELSE NOW() END
           WHERE id = $1
           RETURNING id`,
          [id, isActive]
        );
        if (!result.rows[0]) {
          await db.query("ROLLBACK");
          return null;
        }

        if (!isActive) {
          await db.query(
            `UPDATE approved_recurring_bookings
             SET status = 'cancelled', request_id = NULL, updated_at = NOW()
             WHERE client_id = $1
               AND status = 'active'`,
            [id]
          );
          await db.query(
            `UPDATE recurring_booking_requests
             SET status = 'rejected', reviewed_at = NOW(), updated_at = NOW()
             WHERE client_id = $1
               AND status IN ('pending', 'approved')`,
            [id]
          );
          const removedResult = await db.query(
            `UPDATE session_attendance attendance
             SET status = 'cancelled', credit_consumed = false, updated_at = NOW()
             FROM sessions session
             WHERE attendance.session_id = session.id
               AND attendance.client_id = $1
               AND attendance.status = 'scheduled'
               AND (session.session_date + session.start_time) > LOCALTIMESTAMP
             RETURNING attendance.session_id`,
            [id]
          );
          const sessionIds = [...new Set(removedResult.rows.map((row) => row.session_id))];
          if (sessionIds.length > 0) {
            await db.query(
              `UPDATE sessions session
               SET status = 'cancelled'
               WHERE session.id = ANY($1::bigint[])
                 AND NOT EXISTS (
                   SELECT 1
                   FROM session_attendance attendance
                   WHERE attendance.session_id = session.id
                     AND attendance.status <> 'cancelled'
                 )`,
              [sessionIds]
            );
          }
        }

        const saved = await this.findById(id, db);
        await db.query("COMMIT");
        return saved;
      } catch (error) {
        await db.query("ROLLBACK");
        throw error;
      } finally {
        db.release();
      }
    },

    async findPackageHistory(id) {
      const result = await dbPool.query(
        `SELECT
           package.id,
           package.sessions_total,
           package.sessions_used,
           package.price,
           package.paid,
           package.purchase_date::text,
           package.expiry_date::text,
           package.created_at,
           program.name AS program_name,
           program.type AS program_type
         FROM packages package
         JOIN programs program ON program.id = package.program_id
         WHERE package.client_id = $1
         ORDER BY package.created_at DESC, package.id DESC`,
        [id]
      );
      return result.rows;
    },

    async findSessionHistory(id) {
      const result = await dbPool.query(
        `SELECT
           session.id,
           session.session_date::text,
           session.start_time::text,
           session.duration_minutes,
           session.status AS session_status,
           attendance.status AS attendance_status,
           attendance.credit_consumed,
           (session.session_date + session.start_time)
             <= (CURRENT_TIMESTAMP AT TIME ZONE $2) AS has_started,
           (
             session.session_date
             + session.start_time
             + (session.duration_minutes * INTERVAL '1 minute')
           ) <= (CURRENT_TIMESTAMP AT TIME ZONE $2) AS has_ended,
           package.id AS package_id,
           program.name AS program_name,
           program.type AS program_type
         FROM session_attendance attendance
         JOIN sessions session ON session.id = attendance.session_id
         JOIN packages package ON package.id = attendance.package_id
         JOIN programs program ON program.id = session.program_id
         WHERE attendance.client_id = $1
         ORDER BY session.session_date DESC, session.start_time DESC, session.id DESC`,
        [id, businessTimezone]
      );
      return result.rows;
    },

    async updatePreferences(id, preferredDays, preferredSchedule) {
      const db = await dbPool.connect();
      try {
        await db.query("BEGIN");
        const clientResult = await db.query(
          `SELECT id, is_active
           FROM clients
           WHERE id = $1
           FOR UPDATE`,
          [id]
        );
        if (!clientResult.rows[0]) {
          await db.query("ROLLBACK");
          return null;
        }
        if (!clientResult.rows[0].is_active) {
          const error = new Error("Archived clients cannot update preferences");
          error.code = "CLIENT_ARCHIVED";
          throw error;
        }
        const updateResult = await db.query(
          `UPDATE clients
           SET preferred_days = $2, preferred_schedule = $3::jsonb
           WHERE id = $1
           RETURNING id`,
          [id, preferredDays, JSON.stringify(preferredSchedule)]
        );
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

        await syncPreferenceRequests(
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
