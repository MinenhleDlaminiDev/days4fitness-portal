import { pool as dbPool } from "../db/client.js";
import { requireOwner } from "../lib/ownership.js";

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

    // Hours and scheduling settings belong to one trainer since AUTH-05, so
    // these take the trainer themselves rather than an ownership scope: there
    // is no "all trainers' hours" to serve.
    async listBusinessHours(trainerId) {
      const result = await run(
        `SELECT day_of_week, to_char(start_time, 'HH24:MI') AS start_time
         FROM business_hours
         WHERE trainer_user_id = $1
         ORDER BY day_of_week, start_time`,
        [requireOwner(trainerId)]
      );
      return result.rows;
    },

    async getSchedulingSettings(trainerId) {
      const result = await run(
        `SELECT group_capacity, session_duration_minutes, package_expiry_months
         FROM scheduling_settings
         WHERE trainer_user_id = $1`,
        [requireOwner(trainerId)]
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

    /**
     * Applies the catalogue of package sizes in one transaction. Adding a size
     * also seeds a price row for each session type so it is immediately
     * sellable; removing one clears its prices first. A size that packages were
     * sold at is protected by packages_sessions_total_fkey and surfaces as a
     * foreign-key violation for the service to translate.
     */
    async replacePackageSizes(sizes) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const existing = (
          await client.query("SELECT sessions_total FROM package_sizes")
        ).rows.map((row) => row.sessions_total);

        const removed = existing.filter((size) => !sizes.includes(size));
        const added = sizes.filter((size) => !existing.includes(size));

        for (const size of removed) {
          await client.query("DELETE FROM package_pricing WHERE sessions_total = $1", [size]);
          await client.query("DELETE FROM package_sizes WHERE sessions_total = $1", [size]);
        }
        for (const size of added) {
          await client.query("INSERT INTO package_sizes (sessions_total) VALUES ($1)", [size]);
          await client.query(
            `INSERT INTO package_pricing (program_type, sessions_total, price)
             VALUES ('one_on_one', $1, 0), ('group', $1, 0)
             ON CONFLICT (program_type, sessions_total) DO NOTHING`,
            [size]
          );
        }
        await client.query("COMMIT");
        return { added, removed };
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },

    /**
     * Applies the program catalogue in one transaction. An entry with an id is
     * a rename, one without is a new program, and an existing program missing
     * from the list is removed. Deletes run first so a name can be freed and
     * reused in the same save; packages.program_id restricts the delete of a
     * program that has been sold, and the name of that program is attached to
     * the error for the service to put in its message.
     */
    async replacePrograms(programs) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const existing = (await client.query("SELECT id, name, type FROM programs")).rows;
        const keptIds = new Set(
          programs.filter((program) => program.id !== undefined).map((program) => program.id)
        );

        const removed = existing.filter((program) => !keptIds.has(Number(program.id)));
        for (const program of removed) {
          try {
            await client.query("DELETE FROM programs WHERE id = $1", [program.id]);
          } catch (error) {
            error.programName = program.name;
            throw error;
          }
        }

        const renamed = [];
        for (const program of programs.filter((entry) => entry.id !== undefined)) {
          const result = await client.query(
            "UPDATE programs SET name = $2 WHERE id = $1 RETURNING name",
            [program.id, program.name]
          );
          if (result.rowCount === 0) {
            const error = new Error("Program not found");
            error.code = "PROGRAM_NOT_FOUND";
            error.programId = program.id;
            throw error;
          }
          renamed.push(result.rows[0].name);
        }

        const added = [];
        for (const program of programs.filter((entry) => entry.id === undefined)) {
          const result = await client.query(
            "INSERT INTO programs (name, type) VALUES ($1, $2) RETURNING name",
            [program.name, program.type]
          );
          added.push(result.rows[0].name);
        }

        await client.query("COMMIT");
        return { added, removed: removed.map((program) => program.name) };
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },

    /**
     * Replaces one trainer's whole week in one transaction so a failure
     * changes nothing. The delete is scoped as tightly as the insert: unscoped
     * it would clear every trainer's hours and leave only this one's.
     */
    async replaceBusinessHours(trainerId, slots) {
      const owner = requireOwner(trainerId);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("DELETE FROM business_hours WHERE trainer_user_id = $1", [owner]);
        for (const slot of slots) {
          await client.query(
            `INSERT INTO business_hours (trainer_user_id, day_of_week, start_time)
             VALUES ($1, $2, $3::time)`,
            [owner, slot.dayOfWeek, slot.startTime]
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

    async updateSchedulingSettings(
      trainerId,
      { groupCapacity, sessionDurationMinutes, packageExpiryMonths }
    ) {
      const result = await run(
        `UPDATE scheduling_settings
         SET group_capacity = COALESCE($2, group_capacity),
             session_duration_minutes = COALESCE($3, session_duration_minutes),
             package_expiry_months = COALESCE($4, package_expiry_months),
             updated_at = NOW()
         WHERE trainer_user_id = $1
         RETURNING group_capacity, session_duration_minutes, package_expiry_months`,
        [
          requireOwner(trainerId),
          groupCapacity ?? null,
          sessionDurationMinutes ?? null,
          packageExpiryMonths ?? null
        ]
      );
      return result.rows[0];
    }
  };
}

export const configurationRepository = createConfigurationRepository();
