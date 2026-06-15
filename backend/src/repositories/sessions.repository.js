import { pool } from "../db/client.js";
import { env } from "../config/env.js";

const SESSION_SELECT_SQL = `
  SELECT
    session.id,
    session.program_id,
    session.session_type,
    session.session_date::text,
    session.start_time::text,
    session.duration_minutes,
    session.capacity,
    session.status,
    (session.session_date + session.start_time)
      <= (CURRENT_TIMESTAMP AT TIME ZONE $2) AS has_started,
    (
      session.session_date
      + session.start_time
      + (session.duration_minutes * INTERVAL '1 minute')
    ) <= (CURRENT_TIMESTAMP AT TIME ZONE $2) AS has_ended,
    origin_link.rescheduled_from_session_id,
    replacement_link.replacement_session_id,
    program.name AS program_name,
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'attendanceId', attendance.id,
          'clientId', client.id,
          'clientName', client.name,
          'packageId', package.id,
          'sessionsTotal', package.sessions_total,
          'sessionsUsed', package.sessions_used,
          'paid', package.paid,
          'purchaseDate', package.purchase_date::text,
          'expiryDate', package.expiry_date::text,
          'status', attendance.status,
          'creditConsumed', attendance.credit_consumed
        )
        ORDER BY client.name, attendance.id
      ) FILTER (WHERE attendance.id IS NOT NULL),
      '[]'::jsonb
    ) AS attendees
  FROM sessions session
  JOIN programs program ON program.id = session.program_id
  LEFT JOIN LATERAL (
    SELECT
      CASE
        WHEN COUNT(DISTINCT original.session_id) = 1 THEN MIN(original.session_id)
        ELSE NULL
      END AS rescheduled_from_session_id
    FROM session_attendance replacement_attendance
    JOIN session_attendance original
      ON original.id = replacement_attendance.rescheduled_from_attendance_id
    WHERE replacement_attendance.session_id = session.id
  ) origin_link ON true
  LEFT JOIN LATERAL (
    SELECT MIN(replacement_attendance.session_id) AS replacement_session_id
    FROM session_attendance original
    JOIN session_attendance replacement_attendance
      ON replacement_attendance.rescheduled_from_attendance_id = original.id
    WHERE original.session_id = session.id
  ) replacement_link ON true
  LEFT JOIN session_attendance attendance ON attendance.session_id = session.id
  LEFT JOIN clients client ON client.id = attendance.client_id
  LEFT JOIN packages package ON package.id = attendance.package_id
`;

async function findSession(db, sessionId, lock = false) {
  const result = await db.query(
    `SELECT session.*
     FROM sessions session
     WHERE session.id = $1
     ${lock ? "FOR UPDATE" : ""}`,
    [sessionId]
  );
  return result.rows[0] || null;
}

async function lockPackages(db, packageIds) {
  const ids = [...new Set(packageIds)].sort((a, b) => Number(a) - Number(b));
  if (ids.length === 0) return [];
  const result = await db.query(
    `SELECT
       package.*,
       CURRENT_DATE::text AS current_date,
       program.name AS program_name,
       program.type AS program_type
     FROM packages package
     JOIN programs program ON program.id = package.program_id
     WHERE package.id = ANY($1::bigint[])
     ORDER BY package.id
     FOR UPDATE OF package`,
    [ids]
  );
  return result.rows;
}

async function lockActiveClients(db, clientIds) {
  const ids = [...new Set(clientIds)].sort((a, b) => Number(a) - Number(b));
  if (ids.length === 0) return;
  const result = await db.query(
    `SELECT id, is_active
     FROM clients
     WHERE id = ANY($1::bigint[])
     ORDER BY id
     FOR UPDATE`,
    [ids]
  );
  if (
    result.rows.length !== ids.length ||
    result.rows.some((client) => !client.is_active)
  ) {
    const error = new Error("Archived clients cannot be scheduled");
    error.code = "CLIENT_ARCHIVED";
    throw error;
  }
}

async function lockTargetDate(db, sessionDate) {
  await db.query("SELECT pg_advisory_xact_lock($1, hashtext($2))", [44032, sessionDate]);
}

async function findOverlaps(db, sessionDate, startTime) {
  const result = await db.query(
    `SELECT id, program_id, session_type, start_time::text, capacity
     FROM sessions
     WHERE session_date = $1::date
       AND status <> 'cancelled'
       AND start_time < ($2::time + INTERVAL '60 minutes')
       AND (start_time + INTERVAL '60 minutes') > $2::time
     FOR UPDATE`,
    [sessionDate, startTime]
  );
  return result.rows;
}

async function createSessionRow(db, packageRow, sessionDate, startTime) {
  const overlaps = await findOverlaps(db, sessionDate, startTime);
  const compatibleGroup = overlaps.find(
    (session) =>
      packageRow.program_type === "group" &&
      session.session_type === "group" &&
      session.program_id === packageRow.program_id &&
      session.start_time.slice(0, 5) === startTime
  );

  if (overlaps.length > 0 && (!compatibleGroup || overlaps.length > 1)) {
    const error = new Error("Another session overlaps the requested time");
    error.code = "SLOT_CONFLICT";
    throw error;
  }

  if (compatibleGroup) {
    return compatibleGroup.id;
  }

  const settingsResult = await db.query(
    "SELECT group_capacity FROM scheduling_settings WHERE id = 1"
  );
  const result = await db.query(
    `INSERT INTO sessions (
       program_id,
       session_type,
       session_date,
       start_time,
       capacity,
       status
     )
     VALUES ($1, $2, $3::date, $4::time, $5, 'scheduled')
     RETURNING id`,
    [
      packageRow.program_id,
      packageRow.program_type,
      sessionDate,
      startTime,
      packageRow.program_type === "group" ? settingsResult.rows[0].group_capacity : 1
    ]
  );
  return result.rows[0].id;
}

async function assertPackageCanBook(db, packageRow, sessionDate, creditAlreadyAllocated = false) {
  const purchaseDate =
    packageRow.purchase_date instanceof Date
      ? packageRow.purchase_date.toISOString().slice(0, 10)
      : String(packageRow.purchase_date);
  const expiryDate =
    packageRow.expiry_date instanceof Date
      ? packageRow.expiry_date.toISOString().slice(0, 10)
      : String(packageRow.expiry_date);
  if (sessionDate < packageRow.current_date) {
    const error = new Error("Sessions cannot be booked in the past");
    error.code = "PAST_SESSION";
    throw error;
  }
  if (packageRow.current_date > expiryDate) {
    const error = new Error("The package has expired");
    error.code = "PACKAGE_EXPIRED";
    throw error;
  }
  if (sessionDate < purchaseDate) {
    const error = new Error("A session cannot be booked before the package purchase date");
    error.code = "PACKAGE_INACTIVE";
    throw error;
  }
  if (sessionDate > expiryDate) {
    const error = new Error("The package expires before the requested session date");
    error.code = "PACKAGE_EXPIRED";
    throw error;
  }

  if (!creditAlreadyAllocated) {
    const assignedResult = await db.query(
      `SELECT COUNT(*)::int AS assigned
       FROM session_attendance
       WHERE package_id = $1
         AND status <> 'cancelled'`,
      [packageRow.id]
    );
    if (assignedResult.rows[0].assigned >= packageRow.sessions_total) {
      const error = new Error("The package has no unallocated session credits");
      error.code = "PACKAGE_EXHAUSTED";
      throw error;
    }
  }
}

async function assertSessionTiming(db, session, operation) {
  const result = await db.query(
    `SELECT
       ($1::date + $2::time) > LOCALTIMESTAMP AS has_not_started,
       ($1::date + $2::time) <= LOCALTIMESTAMP AS has_started,
       ($1::date + $2::time + ($3::int * INTERVAL '1 minute')) <= LOCALTIMESTAMP
         AS has_ended`,
    [session.session_date, session.start_time, session.duration_minutes]
  );
  const timing = result.rows[0];

  if (operation === "before_start" && !timing.has_not_started) {
    const error = new Error("This session has already started");
    error.code = "SESSION_ALREADY_STARTED";
    throw error;
  }
  if (operation === "after_start" && !timing.has_started) {
    const error = new Error("This session has not started yet");
    error.code = "SESSION_NOT_STARTED";
    throw error;
  }
  if (operation === "after_end" && !timing.has_ended) {
    const error = new Error("This session has not ended yet");
    error.code = "SESSION_NOT_ENDED";
    throw error;
  }
}

async function insertAttendance(db, sessionId, attendee) {
  await db.query(
    `INSERT INTO session_attendance (
       session_id,
       client_id,
       package_id,
       recurring_booking_id,
       rescheduled_from_attendance_id
     )
     VALUES ($1, $2, $3, $4, $5)`,
    [
      sessionId,
      attendee.client_id,
      attendee.package_id,
      attendee.recurring_booking_id || null,
      attendee.rescheduled_from_attendance_id || null
    ]
  );
}

export function createSessionsRepository(
  dbPool = pool,
  { businessTimezone = env.businessTimezone } = {}
) {
  return {
    async findWeek(weekStart) {
      const result = await dbPool.query(
        `${SESSION_SELECT_SQL}
         WHERE session.session_date BETWEEN $1::date AND ($1::date + 6)
         GROUP BY
           session.id,
           program.name,
           origin_link.rescheduled_from_session_id,
           replacement_link.replacement_session_id
         ORDER BY session.session_date, session.start_time, session.id`,
        [weekStart, businessTimezone]
      );
      return result.rows;
    },

    async findById(sessionId, db = dbPool) {
      const result = await db.query(
        `${SESSION_SELECT_SQL}
         WHERE session.id = $1
         GROUP BY
           session.id,
           program.name,
           origin_link.rescheduled_from_session_id,
           replacement_link.replacement_session_id`,
        [sessionId, businessTimezone]
      );
      return result.rows[0] || null;
    },

    async createManual(clientId, sessionDate, startTime) {
      const db = await dbPool.connect();
      try {
        await db.query("BEGIN");
        await db.query("SELECT set_config('TimeZone', $1, true)", [businessTimezone]);
        const clientResult = await db.query(
          `SELECT id, is_active
           FROM clients
           WHERE id = $1
           FOR UPDATE`,
          [clientId]
        );
        if (!clientResult.rows[0]) {
          await db.query("ROLLBACK");
          return null;
        }
        if (!clientResult.rows[0].is_active) {
          const error = new Error("Archived clients cannot be scheduled");
          error.code = "CLIENT_ARCHIVED";
          throw error;
        }
        await lockTargetDate(db, sessionDate);
        const packageResult = await db.query(
          `SELECT
             package.*,
             CURRENT_DATE::text AS current_date,
             program.name AS program_name,
             program.type AS program_type
           FROM packages package
           JOIN programs program ON program.id = package.program_id
           WHERE package.client_id = $1
           ORDER BY package.created_at DESC, package.id DESC
           LIMIT 1
           FOR UPDATE OF package`,
          [clientId]
        );
        const packageRow = packageResult.rows[0];
        if (!packageRow) {
          await db.query("ROLLBACK");
          return null;
        }
        await assertPackageCanBook(db, packageRow, sessionDate);
        const sessionId = await createSessionRow(db, packageRow, sessionDate, startTime);
        await insertAttendance(db, sessionId, {
          client_id: clientId,
          package_id: packageRow.id
        });
        const saved = await this.findById(sessionId, db);
        await db.query("COMMIT");
        return saved;
      } catch (error) {
        await db.query("ROLLBACK");
        throw error;
      } finally {
        db.release();
      }
    },

    async cancel(sessionId) {
      const db = await dbPool.connect();
      try {
        await db.query("BEGIN");
        await db.query("SELECT set_config('TimeZone', $1, true)", [businessTimezone]);
        const session = await findSession(db, sessionId, true);
        if (!session) {
          await db.query("ROLLBACK");
          return null;
        }
        if (session.status !== "scheduled") {
          const error = new Error("Only scheduled sessions can be cancelled");
          error.code = "SESSION_FINALIZED";
          throw error;
        }
        await assertSessionTiming(db, session, "before_start");
        await db.query("UPDATE sessions SET status = 'cancelled' WHERE id = $1", [sessionId]);
        await db.query(
          `UPDATE session_attendance
           SET status = 'cancelled', credit_consumed = false, updated_at = NOW()
           WHERE session_id = $1
             AND status = 'scheduled'`,
          [sessionId]
        );
        const saved = await this.findById(sessionId, db);
        await db.query("COMMIT");
        return saved;
      } catch (error) {
        await db.query("ROLLBACK");
        throw error;
      } finally {
        db.release();
      }
    },

    async createReplacement(sessionId, sessionDate, startTime) {
      const db = await dbPool.connect();
      try {
        await db.query("BEGIN");
        await db.query("SELECT set_config('TimeZone', $1, true)", [businessTimezone]);
        const clientIdsResult = await db.query(
          "SELECT client_id FROM session_attendance WHERE session_id = $1 ORDER BY client_id",
          [sessionId]
        );
        await lockActiveClients(
          db,
          clientIdsResult.rows.map((row) => row.client_id)
        );
        await lockTargetDate(db, sessionDate);
        const original = await findSession(db, sessionId, true);
        if (!original) {
          await db.query("ROLLBACK");
          return null;
        }
        if (original.status !== "cancelled") {
          const error = new Error("The original session must be cancelled first");
          error.code = "SESSION_NOT_CANCELLED";
          throw error;
        }
        const existingReplacement = await db.query(
          `SELECT replacement.id
           FROM session_attendance original
           JOIN session_attendance replacement
             ON replacement.rescheduled_from_attendance_id = original.id
           WHERE original.session_id = $1
           LIMIT 1`,
          [sessionId]
        );
        if (existingReplacement.rows[0]) {
          const error = new Error("A replacement session has already been booked");
          error.code = "REPLACEMENT_EXISTS";
          throw error;
        }
        const attendanceResult = await db.query(
          `SELECT
             id AS rescheduled_from_attendance_id,
             client_id,
             package_id
           FROM session_attendance
           WHERE session_id = $1
             AND status = 'cancelled'
           ORDER BY package_id
           FOR UPDATE`,
          [sessionId]
        );
        const packages = await lockPackages(
          db,
          attendanceResult.rows.map((row) => row.package_id)
        );
        for (const packageRow of packages) {
          await assertPackageCanBook(db, packageRow, sessionDate, true);
        }
        const packageRow = packages[0];
        const replacementId = await createSessionRow(db, packageRow, sessionDate, startTime);
        for (const attendee of attendanceResult.rows) {
          await insertAttendance(db, replacementId, attendee);
        }
        const saved = await this.findById(replacementId, db);
        await db.query("COMMIT");
        return saved;
      } catch (error) {
        await db.query("ROLLBACK");
        throw error;
      } finally {
        db.release();
      }
    },

    async reschedule(sessionId, sessionDate, startTime) {
      const db = await dbPool.connect();
      try {
        await db.query("BEGIN");
        await db.query("SELECT set_config('TimeZone', $1, true)", [businessTimezone]);
        const clientIdsResult = await db.query(
          "SELECT client_id FROM session_attendance WHERE session_id = $1 ORDER BY client_id",
          [sessionId]
        );
        await lockActiveClients(
          db,
          clientIdsResult.rows.map((row) => row.client_id)
        );
        await lockTargetDate(db, sessionDate);
        const original = await findSession(db, sessionId, true);
        if (!original) {
          await db.query("ROLLBACK");
          return null;
        }
        if (original.status !== "scheduled") {
          const error = new Error("Only scheduled sessions can be rescheduled");
          error.code = "SESSION_FINALIZED";
          throw error;
        }
        await assertSessionTiming(db, original, "before_start");
        const attendanceResult = await db.query(
          `SELECT
             id AS rescheduled_from_attendance_id,
             client_id,
             package_id
           FROM session_attendance
           WHERE session_id = $1
             AND status = 'scheduled'
           ORDER BY package_id
           FOR UPDATE`,
          [sessionId]
        );
        const packages = await lockPackages(
          db,
          attendanceResult.rows.map((row) => row.package_id)
        );
        for (const packageRow of packages) {
          await assertPackageCanBook(db, packageRow, sessionDate, true);
        }
        await db.query("UPDATE sessions SET status = 'cancelled' WHERE id = $1", [sessionId]);
        await db.query(
          `UPDATE session_attendance
           SET status = 'cancelled', credit_consumed = false, updated_at = NOW()
           WHERE session_id = $1
             AND status = 'scheduled'`,
          [sessionId]
        );
        const replacementId = await createSessionRow(db, packages[0], sessionDate, startTime);
        for (const attendee of attendanceResult.rows) {
          await insertAttendance(db, replacementId, attendee);
        }
        const saved = await this.findById(replacementId, db);
        await db.query("COMMIT");
        return saved;
      } catch (error) {
        await db.query("ROLLBACK");
        throw error;
      } finally {
        db.release();
      }
    },

    async recordOutcome(sessionId, clientId, outcome) {
      const db = await dbPool.connect();
      try {
        await db.query("BEGIN");
        await db.query("SELECT set_config('TimeZone', $1, true)", [businessTimezone]);
        const session = await findSession(db, sessionId, true);
        if (!session) {
          await db.query("ROLLBACK");
          return null;
        }
        if (session.status !== "scheduled") {
          const error = new Error("This session has already been finalized");
          error.code = "SESSION_FINALIZED";
          throw error;
        }
        await assertSessionTiming(
          db,
          session,
          outcome === "completed" ? "after_end" : "after_start"
        );
        const attendanceResult = await db.query(
          `SELECT *
           FROM session_attendance
           WHERE session_id = $1
             AND ($2::bigint IS NULL OR client_id = $2)
           ORDER BY package_id
           FOR UPDATE`,
          [sessionId, clientId]
        );
        if (attendanceResult.rows.length === 0) {
          const error = new Error("Session attendee not found");
          error.code = "ATTENDEE_NOT_FOUND";
          throw error;
        }
        if (clientId === null && attendanceResult.rows.length > 1) {
          const error = new Error("A clientId is required for group session outcomes");
          error.code = "CLIENT_REQUIRED";
          throw error;
        }
        if (attendanceResult.rows.some((row) => row.status !== "scheduled")) {
          const error = new Error("This attendance outcome has already been recorded");
          error.code = "CREDIT_ALREADY_CONSUMED";
          throw error;
        }
        const packages = await lockPackages(
          db,
          attendanceResult.rows.map((row) => row.package_id)
        );
        if (packages.some((packageRow) => packageRow.sessions_used >= packageRow.sessions_total)) {
          const error = new Error("The package has no remaining credits");
          error.code = "PACKAGE_EXHAUSTED";
          throw error;
        }
        const attendanceIds = attendanceResult.rows.map((row) => row.id);
        await db.query(
          `UPDATE session_attendance
           SET status = $2, credit_consumed = true, updated_at = NOW()
           WHERE id = ANY($1::bigint[])`,
          [attendanceIds, outcome]
        );
        await db.query(
          `UPDATE packages package
           SET sessions_used = sessions_used + usage.count
           FROM (
             SELECT package_id, COUNT(*)::int AS count
             FROM session_attendance
             WHERE id = ANY($1::bigint[])
             GROUP BY package_id
           ) usage
           WHERE package.id = usage.package_id`,
          [attendanceIds]
        );
        const remainingResult = await db.query(
          `SELECT
             COUNT(*) FILTER (WHERE status = 'scheduled')::int AS scheduled_count,
             COUNT(*) FILTER (WHERE status = 'completed')::int AS completed_count
           FROM session_attendance
           WHERE session_id = $1`,
          [sessionId]
        );
        if (remainingResult.rows[0].scheduled_count === 0) {
          await db.query(
            `UPDATE sessions
             SET status = $2
             WHERE id = $1`,
            [
              sessionId,
              remainingResult.rows[0].completed_count > 0 ? "completed" : "no_show"
            ]
          );
        }
        const saved = await this.findById(sessionId, db);
        await db.query("COMMIT");
        return saved;
      } catch (error) {
        await db.query("ROLLBACK");
        throw error;
      } finally {
        db.release();
      }
    }
  };
}

export const sessionsRepository = createSessionsRepository();
