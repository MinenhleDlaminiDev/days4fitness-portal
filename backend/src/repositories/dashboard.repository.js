import { env } from "../config/env.js";
import { pool } from "../db/client.js";

const TODAY_SQL = "(CURRENT_TIMESTAMP AT TIME ZONE $1)::date";

export function createDashboardRepository(
  dbPool = pool,
  { businessTimezone = env.businessTimezone } = {}
) {
  return {
    async findTodaySessions() {
      const result = await dbPool.query(
        `SELECT
           session.id,
           session.session_date::text,
           session.start_time::text,
           session.session_type,
           session.status,
           session.capacity,
           program.name AS program_name,
           COALESCE(
             jsonb_agg(
               jsonb_build_object(
                 'clientId', client.id,
                 'clientName', client.name,
                 'attendanceStatus', attendance.status,
                 'paid', COALESCE(payment_totals.paid_amount, 0) >= package.price
               )
               ORDER BY client.name, attendance.id
             ) FILTER (WHERE attendance.id IS NOT NULL),
             '[]'::jsonb
           ) AS attendees
         FROM sessions session
         JOIN programs program ON program.id = session.program_id
         LEFT JOIN session_attendance attendance ON attendance.session_id = session.id
         LEFT JOIN clients client ON client.id = attendance.client_id
         LEFT JOIN packages package ON package.id = attendance.package_id
         LEFT JOIN LATERAL (
           SELECT COALESCE(SUM(payment.amount), 0) AS paid_amount
           FROM package_payments payment
           WHERE payment.package_id = package.id
         ) payment_totals ON true
         WHERE session.session_date = ${TODAY_SQL}
           AND session.status <> 'cancelled'
         GROUP BY session.id, program.name
         ORDER BY session.start_time, session.id`,
        [businessTimezone]
      );
      return result.rows;
    },

    async getSummary() {
      const result = await dbPool.query(
        `WITH latest_packages AS (
           SELECT DISTINCT ON (package.client_id)
             package.*,
             client.name AS client_name,
             client.is_active,
             program.name AS program_name,
             program.type AS program_type,
             COALESCE(payment_totals.paid_amount, 0)::numeric(10,2) AS paid_amount
           FROM packages package
           JOIN clients client ON client.id = package.client_id
           JOIN programs program ON program.id = package.program_id
           LEFT JOIN LATERAL (
             SELECT COALESCE(SUM(payment.amount), 0) AS paid_amount
             FROM package_payments payment
             WHERE payment.package_id = package.id
           ) payment_totals ON true
           WHERE client.is_active = true
           ORDER BY package.client_id, package.created_at DESC, package.id DESC
         ),
         package_rollup AS (
           SELECT
             COALESCE(SUM(GREATEST(sessions_total - sessions_used, 0)) FILTER (
               WHERE expiry_date >= ${TODAY_SQL}
             ), 0)::int
               AS remaining_sessions,
             COUNT(*) FILTER (WHERE paid_amount < price)::int AS unpaid_packages,
             COALESCE(SUM(GREATEST(price - paid_amount, 0)), 0)::numeric(10,2)
               AS outstanding_balance,
             COUNT(*) FILTER (
               WHERE expiry_date >= ${TODAY_SQL}
                 AND expiry_date <= (${TODAY_SQL} + INTERVAL '7 days')::date
                 AND sessions_used < sessions_total
             )::int AS expiring_count
           FROM latest_packages
         ),
         attendance_rollup AS (
           SELECT COUNT(*)::int AS completed_sessions
           FROM session_attendance attendance
           JOIN clients client ON client.id = attendance.client_id
           WHERE client.is_active = true
             AND attendance.status = 'completed'
         ),
         revenue_rollup AS (
           SELECT
             COALESCE(SUM(amount) FILTER (
               WHERE date_trunc('month', payment_date::timestamp)
                   = date_trunc('month', ${TODAY_SQL}::timestamp)
                 AND payment_date <= ${TODAY_SQL}
             ), 0)::numeric(10,2) AS month_revenue,
             COALESCE(SUM(amount), 0)::numeric(10,2) AS net_revenue
           FROM package_payments
         )
         SELECT
           attendance_rollup.completed_sessions,
           package_rollup.*,
           revenue_rollup.month_revenue,
           revenue_rollup.net_revenue
         FROM package_rollup
         CROSS JOIN attendance_rollup
         CROSS JOIN revenue_rollup`,
        [businessTimezone]
      );
      return result.rows[0];
    },

    async findUnpaidPackages(limit = 5) {
      const result = await dbPool.query(
        `SELECT *
         FROM (
           SELECT DISTINCT ON (package.client_id)
             package.id,
             package.client_id,
             client.name AS client_name,
             program.name AS program_name,
             program.type AS program_type,
             package.sessions_total,
             package.sessions_used,
             package.price,
             COALESCE(payment_totals.paid_amount, 0)::numeric(10,2) AS paid_amount,
             GREATEST(package.price - COALESCE(payment_totals.paid_amount, 0), 0)::numeric(10,2)
               AS outstanding_balance,
             package.expiry_date::text,
             package.created_at
           FROM packages package
           JOIN clients client ON client.id = package.client_id
           JOIN programs program ON program.id = package.program_id
           LEFT JOIN LATERAL (
             SELECT COALESCE(SUM(payment.amount), 0) AS paid_amount
             FROM package_payments payment
             WHERE payment.package_id = package.id
           ) payment_totals ON true
           WHERE client.is_active = true
           ORDER BY package.client_id, package.created_at DESC, package.id DESC
         ) latest_package
         WHERE paid_amount < price
         ORDER BY outstanding_balance DESC, expiry_date, id
         LIMIT $1`,
        [limit]
      );
      return result.rows;
    },

    async findExpiringPackages(limit = 5) {
      const result = await dbPool.query(
        `SELECT *
         FROM (
           SELECT DISTINCT ON (package.client_id)
             package.id,
             package.client_id,
             client.name AS client_name,
             program.name AS program_name,
             program.type AS program_type,
             package.sessions_total,
             package.sessions_used,
             package.expiry_date::text,
             package.expiry_date - ${TODAY_SQL} AS days_until_expiry,
             package.created_at
           FROM packages package
           JOIN clients client ON client.id = package.client_id
           JOIN programs program ON program.id = package.program_id
           WHERE client.is_active = true
           ORDER BY package.client_id, package.created_at DESC, package.id DESC
         ) latest_package
         WHERE expiry_date::date >= ${TODAY_SQL}
           AND expiry_date::date <= (${TODAY_SQL} + INTERVAL '7 days')::date
           AND sessions_used < sessions_total
         ORDER BY expiry_date::date, id
         LIMIT $2`,
        [businessTimezone, limit]
      );
      return result.rows;
    }
  };
}

export const dashboardRepository = createDashboardRepository();
