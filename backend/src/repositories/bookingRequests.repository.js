import { pool } from "../db/client.js";
import { env } from "../config/env.js";
import { allocatePackageSessions } from "./packageAllocation.repository.js";

const DAY_NAMES = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const REQUEST_SELECT_SQL = `
  SELECT
    request.id,
    request.client_id,
    request.package_id,
    request.day_of_week,
    request.start_time::text,
    request.status,
    request.source,
    request.reviewed_at,
    request.created_at,
    client.name AS client_name,
    package.sessions_total,
    package.sessions_used,
    package.purchase_date::text,
    package.expiry_date::text,
    program.id AS program_id,
    program.name AS program_name,
    program.type AS session_type
  FROM recurring_booking_requests request
  JOIN clients client ON client.id = request.client_id
  JOIN packages package ON package.id = request.package_id
  JOIN programs program ON program.id = package.program_id
`;

export function createBookingRequestsRepository(
  dbPool = pool,
  { businessTimezone = env.businessTimezone } = {}
) {
  return {
    async findPending() {
      const result = await dbPool.query(
        `${REQUEST_SELECT_SQL}
         WHERE request.status = 'pending'
         ORDER BY request.created_at, request.id`
      );
      return result.rows;
    },

    async approve(requestId) {
      const db = await dbPool.connect();
      try {
        await db.query("BEGIN");
        await db.query("SELECT set_config('TimeZone', $1, true)", [businessTimezone]);
        const requestOwnerResult = await db.query(
          "SELECT client_id FROM recurring_booking_requests WHERE id = $1",
          [requestId]
        );
        if (!requestOwnerResult.rows[0]) {
          await db.query("ROLLBACK");
          return null;
        }
        const clientResult = await db.query(
          `SELECT id, is_active
           FROM clients
           WHERE id = $1
           FOR UPDATE`,
          [requestOwnerResult.rows[0].client_id]
        );
        if (!clientResult.rows[0]?.is_active) {
          const error = new Error("Archived clients cannot have preferences approved");
          error.code = "CLIENT_ARCHIVED";
          throw error;
        }
        const requestResult = await db.query(
          `${REQUEST_SELECT_SQL}
           WHERE request.id = $1
           FOR UPDATE OF request`,
          [requestId]
        );
        const request = requestResult.rows[0];
        if (!request) {
          await db.query("ROLLBACK");
          return null;
        }
        if (request.status !== "pending") {
          const error = new Error("Booking request has already been reviewed");
          error.code = "REQUEST_ALREADY_REVIEWED";
          throw error;
        }

        await db.query(
          `SELECT id
           FROM packages
           WHERE id = $1
           FOR UPDATE`,
          [request.package_id]
        );

        const bookingDaysResult = await db.query(
          `SELECT day_of_week
           FROM approved_recurring_bookings
           WHERE package_id = $1
             AND status = 'active'
           UNION
           SELECT $2::smallint AS day_of_week
           ORDER BY day_of_week`,
          [request.package_id, request.day_of_week]
        );
        for (const bookingDay of bookingDaysResult.rows) {
          await db.query("SELECT pg_advisory_xact_lock($1, $2)", [
            44031,
            bookingDay.day_of_week
          ]);
        }

        const bookingResult = await db.query(
          `WITH approved_request AS (
             UPDATE recurring_booking_requests
             SET status = 'approved', reviewed_at = NOW(), updated_at = NOW()
             WHERE id = $1
             RETURNING *
           ),
           booking_dates AS (
             SELECT
               (
                 GREATEST(CURRENT_DATE, $2::date)
                 + (
                   (
                     $3::smallint
                     - EXTRACT(
                       ISODOW FROM GREATEST(CURRENT_DATE, $2::date)
                     )::int
                     + 7
                   ) % 7
                 )
               )::date AS first_date
            )
           INSERT INTO approved_recurring_bookings (
             request_id,
             client_id,
             package_id,
             program_id,
             session_type,
             day_of_week,
             start_time,
             starts_on,
             ends_on
           )
           SELECT
             approved_request.id,
             approved_request.client_id,
             approved_request.package_id,
             $4,
             $5,
             approved_request.day_of_week,
             approved_request.start_time,
             CASE
               WHEN booking_dates.first_date = CURRENT_DATE
                 AND approved_request.start_time <= LOCALTIME
                 THEN booking_dates.first_date + 7
               ELSE booking_dates.first_date
             END,
             $6::date
           FROM approved_request
           CROSS JOIN booking_dates
           RETURNING *`,
          [
            request.id,
            request.purchase_date,
            request.day_of_week,
            request.program_id,
            request.session_type,
            request.expiry_date
          ]
        );

        await allocatePackageSessions(db, request.package_id);
        const generatedSessionsResult = await db.query(
          `SELECT COUNT(*)::int AS count
           FROM session_attendance
           WHERE recurring_booking_id = $1
             AND status = 'scheduled'`,
          [bookingResult.rows[0].id]
        );
        const approvedRequestResult = await db.query(
          `${REQUEST_SELECT_SQL}
           WHERE request.id = $1`,
          [request.id]
        );
        await db.query("COMMIT");
        return {
          request: approvedRequestResult.rows[0],
          booking: bookingResult.rows[0],
          generatedSessions: generatedSessionsResult.rows[0].count
        };
      } catch (error) {
        await db.query("ROLLBACK");
        throw error;
      } finally {
        db.release();
      }
    },

    async reject(requestId) {
      const db = await dbPool.connect();
      try {
        await db.query("BEGIN");
        const requestResult = await db.query(
          `SELECT id, client_id, source, day_of_week, start_time::text, status
           FROM recurring_booking_requests
           WHERE id = $1`,
          [requestId]
        );
        const request = requestResult.rows[0];
        if (!request) {
          await db.query("ROLLBACK");
          return null;
        }
        if (request.status !== "pending") {
          const error = new Error("Booking request has already been reviewed");
          error.code = "REQUEST_ALREADY_REVIEWED";
          throw error;
        }

        let clientPreferences = null;
        if (request.source === "client_preference") {
          const clientResult = await db.query(
            `SELECT preferred_days, preferred_schedule
             FROM clients
             WHERE id = $1
             FOR UPDATE`,
            [request.client_id]
          );
          clientPreferences = clientResult.rows[0];
        }

        const rejectedResult = await db.query(
          `UPDATE recurring_booking_requests
           SET status = 'rejected', reviewed_at = NOW(), updated_at = NOW()
           WHERE id = $1
             AND status = 'pending'
           RETURNING id, client_id, package_id, day_of_week, start_time::text, status, reviewed_at`,
          [requestId]
        );
        if (!rejectedResult.rows[0]) {
          const error = new Error("Booking request has already been reviewed");
          error.code = "REQUEST_ALREADY_REVIEWED";
          throw error;
        }

        if (clientPreferences) {
          const day = DAY_NAMES[request.day_of_week];
          const preferredSchedule = { ...(clientPreferences.preferred_schedule || {}) };
          const remainingSlots = (preferredSchedule[day] || []).filter(
            (slot) => String(slot).slice(0, 5) !== request.start_time.slice(0, 5)
          );
          let preferredDays = Array.isArray(clientPreferences.preferred_days)
            ? clientPreferences.preferred_days
            : [];

          if (remainingSlots.length > 0) {
            preferredSchedule[day] = remainingSlots;
          } else {
            delete preferredSchedule[day];
            preferredDays = preferredDays.filter((preferredDay) => preferredDay !== day);
          }

          await db.query(
            `UPDATE clients
             SET preferred_days = $2,
                 preferred_schedule = $3::jsonb
             WHERE id = $1`,
            [request.client_id, preferredDays, JSON.stringify(preferredSchedule)]
          );
        }

        await db.query("COMMIT");
        return rejectedResult.rows[0];
      } catch (error) {
        await db.query("ROLLBACK");
        throw error;
      } finally {
        db.release();
      }
    }
  };
}

export const bookingRequestsRepository = createBookingRequestsRepository();
