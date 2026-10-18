import { pool as dbPool } from "../db/client.js";

export function createConfigurationRepository(pool = dbPool) {
  const run = (text, values) => pool.query(text, values);

  return {
    async listPrograms() {
      const result = await run(
        `SELECT id, name, type
         FROM programs
         ORDER BY name, type`
      );
      return result.rows;
    },

    async listPricing() {
      const result = await run(
        `SELECT program_type, sessions_total, price
         FROM package_pricing
         ORDER BY program_type, sessions_total`
      );
      return result.rows;
    },

    async listPackageSizes() {
      const result = await run(
        `SELECT sessions_total
         FROM package_sizes
         ORDER BY sessions_total`
      );
      return result.rows.map((row) => row.sessions_total);
    },

    async listBusinessHours() {
      const result = await run(
        `SELECT day_of_week, to_char(start_time, 'HH24:MI') AS start_time
         FROM business_hours
         ORDER BY day_of_week, start_time`
      );
      return result.rows;
    },

    async getSchedulingSettings() {
      const result = await run(
        `SELECT group_capacity, session_duration_minutes, package_expiry_months
         FROM scheduling_settings
         WHERE id = 1`
      );
      return result.rows[0];
    },

    /** Replaces the price of each (sessionType, sessionsTotal) pair given. */
    async updatePricing(entries) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        for (const entry of entries) {
          const result = await client.query(
            `UPDATE package_pricing
             SET price = $3
             WHERE program_type = $1 AND sessions_total = $2`,
            [entry.programType, entry.sessionsTotal, entry.price]
          );
          if (result.rowCount === 0) {
            await client.query(
              `INSERT INTO package_pricing (program_type, sessions_total, price)
               VALUES ($1, $2, $3)`,
              [entry.programType, entry.sessionsTotal, entry.price]
            );
          }
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },

    /** Replaces the whole week in one transaction so a failure changes nothing. */
    async replaceBusinessHours(slots) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("DELETE FROM business_hours");
        for (const slot of slots) {
          await client.query(
            `INSERT INTO business_hours (day_of_week, start_time)
             VALUES ($1, $2::time)`,
            [slot.dayOfWeek, slot.startTime]
          );
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },

    async updateSchedulingSettings({ groupCapacity, sessionDurationMinutes, packageExpiryMonths }) {
      const result = await run(
        `UPDATE scheduling_settings
         SET group_capacity = COALESCE($1, group_capacity),
             session_duration_minutes = COALESCE($2, session_duration_minutes),
             package_expiry_months = COALESCE($3, package_expiry_months),
             updated_at = NOW()
         WHERE id = 1
         RETURNING group_capacity, session_duration_minutes, package_expiry_months`,
        [groupCapacity ?? null, sessionDurationMinutes ?? null, packageExpiryMonths ?? null]
      );
      return result.rows[0];
    }
  };
}

export const configurationRepository = createConfigurationRepository();
