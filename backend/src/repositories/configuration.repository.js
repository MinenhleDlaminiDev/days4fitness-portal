import { pool as dbPool } from "../db/client.js";
import { env } from "../config/env.js";
import { requireOwner } from "../lib/ownership.js";

// SCH-05: only the hour check needs a clock, and it must be the business one.
// Taken as an option the way the other repositories take it, so a test can pin
// it. See SCH-04 for why a bare CURRENT_DATE is wrong here.
/**
 * One entry per (day, time) still in use, with the earliest date and up to
 * three client names. A session and a recurring booking in the same hour are
 * one problem to the trainer, so they are merged rather than listed twice.
 */
function mergeBlockingSlots(rows) {
  const bySlot = new Map();
  for (const row of rows) {
    const key = `${row.day_of_week}-${row.start_time}`;
    const found = bySlot.get(key);
    const names = row.names || [];
    if (!found) {
      bySlot.set(key, {
        dayOfWeek: Number(row.day_of_week),
        startTime: row.start_time.slice(0, 5),
        total: row.total,
        firstDate: row.first_date,
        names: [...names]
      });
      continue;
    }
    found.total += row.total;
    if (row.first_date < found.firstDate) found.firstDate = row.first_date;
    for (const name of names) {
      if (!found.names.includes(name)) found.names.push(name);
    }
  }
  return [...bySlot.values()]
    .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime))
    .map((slot) => ({ ...slot, names: slot.names.slice(0, 3) }));
}

export function createConfigurationRepository(
  pool = dbPool,
  { businessTimezone = env.businessTimezone } = {}
) {
  const run = (text, values) => pool.query(text, values);

  return {
    // AUTH-10 made the catalogue per trainer as well, so every method here
    // takes the trainer whose configuration it is. requireOwner rejects null,
    // because null is an admin's *read scope* and there is no such thing as
    // "all trainers' prices" to serve or to write.
    async listPrograms(trainerId) {
      const result = await run(
        `SELECT id, name, type
         FROM programs
         WHERE trainer_user_id = $1
         ORDER BY name, type`,
        [requireOwner(trainerId)]
      );
      return result.rows;
    },

    async listPricing(trainerId) {
      const result = await run(
        `SELECT program_type, sessions_total, price
         FROM package_pricing
         WHERE trainer_user_id = $1
         ORDER BY program_type, sessions_total`,
        [requireOwner(trainerId)]
      );
      return result.rows;
    },

    async listPackageSizes(trainerId) {
      const result = await run(
        `SELECT sessions_total
         FROM package_sizes
         WHERE trainer_user_id = $1
         ORDER BY sessions_total`,
        [requireOwner(trainerId)]
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
    async updatePricing(trainerId, entries) {
      const owner = requireOwner(trainerId);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        for (const entry of entries) {
          const result = await client.query(
            `UPDATE package_pricing
             SET price = $3
             WHERE program_type = $1 AND sessions_total = $2 AND trainer_user_id = $4`,
            [entry.programType, entry.sessionsTotal, entry.price, owner]
          );
          if (result.rowCount === 0) {
            await client.query(
              `INSERT INTO package_pricing (program_type, sessions_total, price, trainer_user_id)
               VALUES ($1, $2, $3, $4)`,
              [entry.programType, entry.sessionsTotal, entry.price, owner]
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
     * Applies one trainer's catalogue of package sizes in one transaction.
     * Adding a size also seeds a price row for each session type so it is
     * immediately sellable; removing one clears its prices first. A size that
     * packages were sold at is protected by the package_sizes_protect_sold
     * trigger from migration 024, which raises 23503 like the foreign key it
     * replaced, so the service's translation is unchanged.
     *
     * Every statement is scoped. Unscoped, one trainer saving their sizes
     * would delete every other trainer's.
     */
    async replacePackageSizes(trainerId, sizes) {
      const owner = requireOwner(trainerId);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const existing = (
          await client.query(
            "SELECT sessions_total FROM package_sizes WHERE trainer_user_id = $1",
            [owner]
          )
        ).rows.map((row) => row.sessions_total);

        const removed = existing.filter((size) => !sizes.includes(size));
        const added = sizes.filter((size) => !existing.includes(size));

        for (const size of removed) {
          await client.query(
            "DELETE FROM package_pricing WHERE sessions_total = $1 AND trainer_user_id = $2",
            [size, owner]
          );
          await client.query(
            "DELETE FROM package_sizes WHERE sessions_total = $1 AND trainer_user_id = $2",
            [size, owner]
          );
        }
        for (const size of added) {
          await client.query(
            "INSERT INTO package_sizes (sessions_total, trainer_user_id) VALUES ($1, $2)",
            [size, owner]
          );
          await client.query(
            `INSERT INTO package_pricing (program_type, sessions_total, price, trainer_user_id)
             VALUES ('one_on_one', $1, 0, $2), ('group', $1, 0, $2)
             ON CONFLICT (trainer_user_id, program_type, sessions_total) DO NOTHING`,
            [size, owner]
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
    async replacePrograms(trainerId, programs) {
      const owner = requireOwner(trainerId);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const existing = (
          await client.query("SELECT id, name, type FROM programs WHERE trainer_user_id = $1", [
            owner
          ])
        ).rows;
        const keptIds = new Set(
          programs.filter((program) => program.id !== undefined).map((program) => program.id)
        );

        const removed = existing.filter((program) => !keptIds.has(Number(program.id)));
        for (const program of removed) {
          try {
            await client.query("DELETE FROM programs WHERE id = $1 AND trainer_user_id = $2", [
              program.id,
              owner
            ]);
          } catch (error) {
            error.programName = program.name;
            throw error;
          }
        }

        // The owner predicate on the rename matters as much as on the delete:
        // without it an id from another trainer's catalogue would be accepted
        // and silently renamed.
        const renamed = [];
        for (const program of programs.filter((entry) => entry.id !== undefined)) {
          const result = await client.query(
            "UPDATE programs SET name = $2 WHERE id = $1 AND trainer_user_id = $3 RETURNING name",
            [program.id, program.name, owner]
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
            "INSERT INTO programs (name, type, trainer_user_id) VALUES ($1, $2, $3) RETURNING name",
            [program.name, program.type, owner]
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
      const keptDays = slots.map((slot) => slot.dayOfWeek);
      const keptTimes = slots.map((slot) => slot.startTime);
      try {
        await client.query("BEGIN");

        // SCH-05: an hour cannot be removed while something is booked in it.
        // The schedule grid draws its rows from these very rows, so a session
        // left in a removed hour disappears from it while still holding the
        // client's credit. Refused instead, the way a program or a package
        // size that has been sold is refused.
        //
        // Inside the transaction and before the delete, so a booking made in
        // that hour at the same moment cannot slip past the check.
        const bookedSessions = await client.query(
          `SELECT
             EXTRACT(ISODOW FROM session.session_date)::int AS day_of_week,
             session.start_time::text AS start_time,
             COUNT(*)::int AS total,
             MIN(session.session_date)::text AS first_date,
             (ARRAY_REMOVE(ARRAY_AGG(DISTINCT client.name), NULL))[1:3] AS names
           FROM sessions session
           LEFT JOIN session_attendance attendance
             ON attendance.session_id = session.id AND attendance.status <> 'cancelled'
           LEFT JOIN clients client ON client.id = attendance.client_id
           WHERE session.trainer_user_id = $1
             AND session.status <> 'cancelled'
             -- Date AND time: a session earlier today is history, and a
             -- trainer narrowing hours they used to work must not be held up
             -- by it. The business clock, never the server's (SCH-04).
             AND (session.session_date + session.start_time)
                   > (CURRENT_TIMESTAMP AT TIME ZONE $4)
             AND NOT EXISTS (
               SELECT 1
               FROM unnest($2::int[], $3::time[]) AS kept(day_of_week, start_time)
               WHERE kept.day_of_week = EXTRACT(ISODOW FROM session.session_date)
                 AND kept.start_time = session.start_time
             )
           GROUP BY 1, 2
           ORDER BY 1, 2`,
          [owner, keptDays, keptTimes, businessTimezone]
        );

        // An approved recurring booking keeps generating sessions, and the
        // allocator never looks at business_hours, so checking only the
        // sessions that exist today would leave the hole half open.
        const recurring = await client.query(
          `SELECT
             booking.day_of_week,
             booking.start_time::text AS start_time,
             COUNT(*)::int AS total,
             MIN(booking.starts_on)::text AS first_date,
             (ARRAY_REMOVE(ARRAY_AGG(DISTINCT client.name), NULL))[1:3] AS names
           FROM approved_recurring_bookings booking
           JOIN clients client ON client.id = booking.client_id
           WHERE client.trainer_user_id = $1
             AND booking.status = 'active'
             AND booking.ends_on >= (CURRENT_TIMESTAMP AT TIME ZONE $4)::date
             AND NOT EXISTS (
               SELECT 1
               FROM unnest($2::int[], $3::time[]) AS kept(day_of_week, start_time)
               WHERE kept.day_of_week = booking.day_of_week
                 AND kept.start_time = booking.start_time
             )
           GROUP BY 1, 2
           ORDER BY 1, 2`,
          [owner, keptDays, keptTimes, businessTimezone]
        );

        const blocking = [...bookedSessions.rows, ...recurring.rows];
        if (blocking.length > 0) {
          // The catch below rolls back; nothing has been written yet anyway.
          const error = new Error("Training hours are in use");
          error.code = "BUSINESS_HOURS_IN_USE";
          // Merged by slot, because a session and a recurring booking in the
          // same hour are one problem to the trainer, not two.
          error.slots = mergeBlockingSlots(blocking);
          throw error;
        }

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
