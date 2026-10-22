import { pool } from "../db/client.js";
import { requireScope } from "../lib/ownership.js";

// AUTH-06. Both queries are filtered by owner. Sessions carry
// trainer_user_id since AUTH-04; payments reach their owner through
// package -> client, which is why the revenue CTE joins two tables it
// selects nothing from. It previously read package_payments on its own and
// reported the whole business's income to every trainer.

export function createReportsRepository(dbPool = pool) {
  return {
    /**
     * Revenue and the session status split for one date range, in a single
     * round trip. Revenue counts package_payments by payment_date, the same
     * definition the dashboard uses, so the two screens cannot disagree.
     */
    async getSummary({ from, to }, scope) {
      const result = await dbPool.query(
        `WITH revenue AS (
           SELECT COALESCE(SUM(payment.amount), 0)::numeric(10,2) AS total
           FROM package_payments payment
           JOIN packages package ON package.id = payment.package_id
           JOIN clients client ON client.id = package.client_id
           WHERE payment.payment_date BETWEEN $1::date AND $2::date
             AND ($3::bigint IS NULL OR client.trainer_user_id = $3)
         ),
         sessions_in_range AS (
           SELECT status
           FROM sessions
           WHERE session_date BETWEEN $1::date AND $2::date
             AND ($3::bigint IS NULL OR trainer_user_id = $3)
         ),
         attendance_in_range AS (
           SELECT attendance.status
           FROM session_attendance attendance
           JOIN sessions session ON session.id = attendance.session_id
           WHERE session.session_date BETWEEN $1::date AND $2::date
             AND ($3::bigint IS NULL OR session.trainer_user_id = $3)
         )
         SELECT
           revenue.total AS revenue,
           (SELECT COUNT(*) FROM sessions_in_range)::int AS sessions_total,
           (SELECT COUNT(*) FROM sessions_in_range WHERE status = 'completed')::int
             AS sessions_completed,
           (SELECT COUNT(*) FROM sessions_in_range WHERE status = 'no_show')::int
             AS sessions_no_show,
           (SELECT COUNT(*) FROM sessions_in_range WHERE status = 'cancelled')::int
             AS sessions_cancelled,
           (SELECT COUNT(*) FROM sessions_in_range WHERE status = 'scheduled')::int
             AS sessions_scheduled,
           (SELECT COUNT(*) FROM attendance_in_range)::int AS attendances_total,
           (SELECT COUNT(*) FROM attendance_in_range WHERE status = 'completed')::int
             AS attendances_completed,
           (SELECT COUNT(*) FROM attendance_in_range WHERE status = 'no_show')::int
             AS attendances_no_show
         FROM revenue`,
        [from, to, requireScope(scope)]
      );
      return result.rows[0];
    },

    /**
     * Per-client totals for the range: attendance by outcome and what they
     * actually paid. One query for every client, not one per client.
     */
    async getClientBreakdown({ from, to }, scope) {
      const result = await dbPool.query(
        `WITH attendance_totals AS (
           SELECT
             attendance.client_id,
             COUNT(*)::int AS sessions_booked,
             COUNT(*) FILTER (WHERE attendance.status = 'completed')::int AS sessions_completed,
             COUNT(*) FILTER (WHERE attendance.status = 'no_show')::int AS sessions_no_show,
             COUNT(*) FILTER (WHERE attendance.status = 'cancelled')::int AS sessions_cancelled
           FROM session_attendance attendance
           JOIN sessions session ON session.id = attendance.session_id
           WHERE session.session_date BETWEEN $1::date AND $2::date
             AND ($3::bigint IS NULL OR session.trainer_user_id = $3)
           GROUP BY attendance.client_id
         ),
         payment_totals AS (
           SELECT
             package.client_id,
             COALESCE(SUM(payment.amount), 0)::numeric(10,2) AS amount_paid
           FROM package_payments payment
           JOIN packages package ON package.id = payment.package_id
           JOIN clients client ON client.id = package.client_id
           WHERE payment.payment_date BETWEEN $1::date AND $2::date
             AND ($3::bigint IS NULL OR client.trainer_user_id = $3)
           GROUP BY package.client_id
         )
         SELECT
           client.id,
           client.name,
           client.is_active,
           COALESCE(attendance_totals.sessions_booked, 0) AS sessions_booked,
           COALESCE(attendance_totals.sessions_completed, 0) AS sessions_completed,
           COALESCE(attendance_totals.sessions_no_show, 0) AS sessions_no_show,
           COALESCE(attendance_totals.sessions_cancelled, 0) AS sessions_cancelled,
           COALESCE(payment_totals.amount_paid, 0)::numeric(10,2) AS amount_paid
         FROM clients client
         LEFT JOIN attendance_totals ON attendance_totals.client_id = client.id
         LEFT JOIN payment_totals ON payment_totals.client_id = client.id
         WHERE (attendance_totals.client_id IS NOT NULL
             OR payment_totals.client_id IS NOT NULL)
           AND ($3::bigint IS NULL OR client.trainer_user_id = $3)
         ORDER BY payment_totals.amount_paid DESC NULLS LAST, client.name`,
        [from, to, requireScope(scope)]
      );
      return result.rows;
    }
  };
}

export const reportsRepository = createReportsRepository();
