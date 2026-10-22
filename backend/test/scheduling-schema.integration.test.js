import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { env } from "../src/config/env.js";
import { applyMigrations } from "../src/db/migrationRunner.js";
import { ensureTestTrainer, OWNER_SUBQUERY, programFor } from "./helpers/trainer.js";

const { Pool } = pg;
const migrationsDirectory = fileURLToPath(
  new URL("../../database/migrations", import.meta.url)
);

if (!env.testDatabaseUrl || !new URL(env.testDatabaseUrl).pathname.toLowerCase().includes("test")) {
  throw new Error("Integration tests require a safe TEST_DATABASE_URL");
}

const testPool = new Pool({ connectionString: env.testDatabaseUrl });

// Fixtures own their clients since AUTH-03, so the suite needs a trainer
// for them to belong to. Top-level await, so it is done before any test runs.
await ensureTestTrainer(testPool);

after(async () => {
  await testPool.end();
});

function migrationSql(filename) {
  return fs.readFileSync(path.join(migrationsDirectory, filename), "utf8");
}

test("records migrations and does not reapply completed files", async () => {
  const before = await testPool.query("SELECT filename FROM schema_migrations ORDER BY filename");
  const appliedAgain = [];

  await applyMigrations(testPool, (message) => appliedAgain.push(message));

  // Compared against the directory rather than a hardcoded list, so adding a
  // migration does not require editing this assertion.
  const onDisk = fs
    .readdirSync(migrationsDirectory)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  assert.ok(onDisk.length > 0, "expected migration files on disk");
  assert.deepEqual(before.rows.map((row) => row.filename), onDisk);
  assert.deepEqual(appliedAgain, []);
});

test("creates the Phase 2 scheduling schema and defaults", async () => {
  // One row per trainer since AUTH-05, seeded with the same defaults the
  // single row used to hold.
  const settings = await testPool.query(
    `SELECT group_capacity, session_duration_minutes
     FROM scheduling_settings
     WHERE trainer_user_id = ${OWNER_SUBQUERY}`
  );
  const sessionColumns = await testPool.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'sessions'`
  );
  const attendanceColumns = await testPool.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'session_attendance'`
  );
  const columnNames = new Set(sessionColumns.rows.map((row) => row.column_name));
  const attendanceColumnNames = new Set(
    attendanceColumns.rows.map((row) => row.column_name)
  );

  assert.deepEqual(settings.rows[0], {
    group_capacity: 8,
    session_duration_minutes: 60
  });
  assert.equal(columnNames.has("session_type"), true);
  assert.equal(columnNames.has("status"), true);
  assert.equal(columnNames.has("rescheduled_from_session_id"), false);
  assert.equal(attendanceColumnNames.has("rescheduled_from_attendance_id"), true);
  assert.equal(columnNames.has("client_id"), false);
  assert.equal(columnNames.has("package_id"), false);
  assert.equal(columnNames.has("completed"), false);
});

test("allows multiple clients to attend one group session", async () => {
  const db = await testPool.connect();

  try {
    await db.query("BEGIN");
    const program = await db.query(
      `SELECT id FROM programs
       WHERE type = 'group' AND trainer_user_id = (SELECT id FROM trainer_users ORDER BY id LIMIT 1)
       ORDER BY id LIMIT 1`
    );
    const clients = await db.query(
      `INSERT INTO clients (name, phone, trainer_user_id)
       VALUES
         ('Group Client One', '+27 82 000 1001', ${OWNER_SUBQUERY}),
         ('Group Client Two', '+27 82 000 1002', ${OWNER_SUBQUERY})
       RETURNING id`
    );
    const firstPackage = await db.query(
      `INSERT INTO packages (
         client_id,
         program_id,
         sessions_total,
         price,
         purchase_date,
         expiry_date
       )
       VALUES ($1, $2, 4, 1000, '2026-06-01', '2026-08-01')
       RETURNING id`,
      [clients.rows[0].id, program.rows[0].id]
    );
    const secondPackage = await db.query(
      `INSERT INTO packages (
         client_id,
         program_id,
         sessions_total,
         price,
         purchase_date,
         expiry_date
       )
       VALUES ($1, $2, 4, 1000, '2026-06-01', '2026-08-01')
       RETURNING id`,
      [clients.rows[1].id, program.rows[0].id]
    );
    const session = await db.query(
      `INSERT INTO sessions (
         program_id,
         session_type,
         session_date,
         start_time,
         capacity,
         status,
         trainer_user_id
       )
       VALUES ($1, 'group', '2026-06-17', '09:00', 8, 'scheduled', ${OWNER_SUBQUERY})
       RETURNING id`,
      [program.rows[0].id]
    );

    await db.query(
      `INSERT INTO session_attendance (session_id, client_id, package_id)
       VALUES ($1, $2, $3), ($1, $4, $5)`,
      [
        session.rows[0].id,
        clients.rows[0].id,
        firstPackage.rows[0].id,
        clients.rows[1].id,
        secondPackage.rows[0].id
      ]
    );

    const attendance = await db.query(
      "SELECT COUNT(*)::int AS count FROM session_attendance WHERE session_id = $1",
      [session.rows[0].id]
    );

    assert.equal(attendance.rows[0].count, 2);
  } finally {
    await db.query("ROLLBACK");
    db.release();
  }
});

test("preserves legacy preferences and session attendance during migration", async () => {
  const schemaName = `phase2_legacy_${Date.now()}`;
  const db = await testPool.connect();

  try {
    await db.query(`CREATE SCHEMA "${schemaName}"`);
    await db.query(`SET search_path TO "${schemaName}"`);

    for (const filename of [
      "001_init.sql",
      "002_pricing_seed.sql",
      "003_clients_preferred_days.sql",
      "004_clients_preferred_schedule.sql"
    ]) {
      await db.query(migrationSql(filename));
    }

    const clientResult = await db.query(
      // No owner column here on purpose: this schema is built from migrations
      // 001-004 only, which is before AUTH-03 added it.
      `INSERT INTO clients (name, phone, preferred_days, preferred_schedule)
       VALUES (
         'Legacy Client',
         '+27 82 111 2222',
         ARRAY['Monday', 'Saturday'],
         '{"Monday":["08:00"],"Saturday":["10:00"]}'::jsonb
       )
       RETURNING id`
    );
    // Unscoped on purpose, like the client insert above: this schema stops at
    // migration 004, so programs has no trainer_user_id column yet.
    const programResult = await db.query(
      `SELECT id FROM programs
       WHERE name = 'Weight Loss' AND type = 'one_on_one'
       LIMIT 1`
    );
    const packageResult = await db.query(
      `INSERT INTO packages (
         client_id,
         program_id,
         sessions_total,
         price,
         paid,
         purchase_date,
         expiry_date
       )
       VALUES ($1, $2, 4, 1520, true, '2026-06-01', '2026-08-01')
       RETURNING id`,
      [clientResult.rows[0].id, programResult.rows[0].id]
    );
    const sessionResult = await db.query(
      `INSERT INTO sessions (package_id, client_id, session_date, start_time, completed)
       VALUES ($1, $2, '2026-06-15', '08:00', true)
       RETURNING id`,
      [packageResult.rows[0].id, clientResult.rows[0].id]
    );

    // 021 refuses to leave clients unowned, and this scratch schema starts at
    // migration 004, so trainer_users does not exist yet and cannot be seeded
    // beforehand. Run the migrations, seed the first trainer when the guard
    // stops them, then let the run finish: the runner records what it applied,
    // so the second call resumes rather than repeating. The catch is doing real
    // work here -- it proves the guard fires rather than leaving rows unowned.
    try {
      await applyMigrations(db, () => {});
    } catch (error) {
      if (!String(error.message).includes("Cannot assign client ownership")) throw error;
      await db.query(
        `INSERT INTO trainer_users (email, name, role, password_hash)
         VALUES ('legacy-owner@days4fitness.local', 'Legacy Owner', 'admin', 'not-a-real-hash')`
      );
      await applyMigrations(db, () => {});
    }

    const requests = await db.query(
      `SELECT day_of_week, start_time::text, status, source
       FROM recurring_booking_requests
       WHERE client_id = $1
       ORDER BY day_of_week`,
      [clientResult.rows[0].id]
    );
    const attendance = await db.query(
      `SELECT client_id, package_id, status, credit_consumed
       FROM session_attendance
       WHERE session_id = $1`,
      [sessionResult.rows[0].id]
    );
    const migratedSession = await db.query(
      "SELECT session_type, status, duration_minutes, capacity FROM sessions WHERE id = $1",
      [sessionResult.rows[0].id]
    );
    const migratedPayment = await db.query(
      `SELECT amount, method, reference
       FROM package_payments
       WHERE package_id = $1`,
      [packageResult.rows[0].id]
    );
    const appliedMigrations = await db.query(
      "SELECT filename FROM schema_migrations ORDER BY filename"
    );

    assert.deepEqual(requests.rows, [
      {
        day_of_week: 1,
        start_time: "08:00:00",
        status: "pending",
        source: "client_preference"
      },
      {
        day_of_week: 6,
        start_time: "10:00:00",
        status: "pending",
        source: "client_preference"
      }
    ]);
    assert.deepEqual(attendance.rows[0], {
      client_id: clientResult.rows[0].id,
      package_id: packageResult.rows[0].id,
      status: "completed",
      credit_consumed: true
    });
    assert.deepEqual(migratedSession.rows[0], {
      session_type: "one_on_one",
      status: "completed",
      duration_minutes: 60,
      capacity: 1
    });
    assert.deepEqual(migratedPayment.rows[0], {
      amount: "1520.00",
      method: "legacy",
      reference: "Migrated paid package"
    });
    assert.deepEqual(
      appliedMigrations.rows.map((row) => row.filename),
      fs
        .readdirSync(migrationsDirectory)
        .filter((file) => file.endsWith(".sql"))
        .sort()
    );
  } finally {
    await db.query("SET search_path TO public");
    await db.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    db.release();
  }
});

test("enforces training-day, status, and active-slot constraints", async () => {
  const client = await testPool.query(
    `INSERT INTO clients (name, phone, trainer_user_id)
     VALUES ('Phase 2 Constraint Client', '+27 82 333 4444', ${OWNER_SUBQUERY})
     RETURNING id`
  );

  try {
    const program = await testPool.query(
      `SELECT id FROM programs
       WHERE type = 'one_on_one' AND trainer_user_id = (SELECT id FROM trainer_users ORDER BY id LIMIT 1)
       ORDER BY id LIMIT 1`
    );

    await assert.rejects(
      testPool.query(
        `INSERT INTO sessions (
           program_id,
           session_type,
           session_date,
           start_time,
           capacity,
           status,
           trainer_user_id
         )
         VALUES ($1, 'one_on_one', '2026-06-14', '08:00', 1, 'scheduled', ${OWNER_SUBQUERY})`,
        [program.rows[0].id]
      ),
      (error) => error.code === "23514"
    );

    const session = await testPool.query(
      `INSERT INTO sessions (
         program_id,
         session_type,
         session_date,
         start_time,
         capacity,
         status,
         trainer_user_id
       )
       VALUES ($1, 'one_on_one', '2026-06-15', '08:00', 1, 'scheduled', ${OWNER_SUBQUERY})
       RETURNING id`,
      [program.rows[0].id]
    );

    // An exact clash. 23P01 is sessions_no_overlap, which replaced the old
    // unique index on (session_date, start_time) in migration 019.
    await assert.rejects(
      testPool.query(
        `INSERT INTO sessions (
           program_id,
           session_type,
           session_date,
           start_time,
           capacity,
           status,
           trainer_user_id
         )
         VALUES ($1, 'one_on_one', '2026-06-15', '08:00', 1, 'scheduled', ${OWNER_SUBQUERY})`,
        [program.rows[0].id]
      ),
      (error) => error.code === "23P01"
    );

    // A partial overlap: 08:30 starts inside the 08:00-09:00 session. The old
    // unique index let this through because the start times differ.
    await assert.rejects(
      testPool.query(
        `INSERT INTO sessions (
           program_id,
           session_type,
           session_date,
           start_time,
           capacity,
           status,
           trainer_user_id
         )
         VALUES ($1, 'one_on_one', '2026-06-15', '08:30', 1, 'scheduled', ${OWNER_SUBQUERY})`,
        [program.rows[0].id]
      ),
      (error) => error.code === "23P01"
    );

    // A longer session reaching forward into the next slot is caught too.
    await assert.rejects(
      testPool.query(
        `INSERT INTO sessions (
           program_id,
           session_type,
           session_date,
           start_time,
           duration_minutes,
           capacity,
           status,
           trainer_user_id
         )
         VALUES ($1, 'one_on_one', '2026-06-15', '07:00', 90, 1, 'scheduled', ${OWNER_SUBQUERY})`,
        [program.rows[0].id]
      ),
      (error) => error.code === "23P01"
    );

    // Back to back is legal: 09:00 begins exactly as 08:00-09:00 ends.
    const backToBack = await testPool.query(
      `INSERT INTO sessions (
         program_id,
         session_type,
         session_date,
         start_time,
         capacity,
         status,
         trainer_user_id
       )
       VALUES ($1, 'one_on_one', '2026-06-15', '09:00', 1, 'scheduled', ${OWNER_SUBQUERY})
       RETURNING id`,
      [program.rows[0].id]
    );
    await testPool.query("DELETE FROM sessions WHERE id = $1", [backToBack.rows[0].id]);

    await testPool.query("UPDATE sessions SET status = 'cancelled' WHERE id = $1", [
      session.rows[0].id
    ]);
    await testPool.query(
      `INSERT INTO sessions (
         program_id,
         session_type,
         session_date,
         start_time,
         capacity,
         status,
         trainer_user_id
       )
       VALUES ($1, 'one_on_one', '2026-06-16', '08:00', 1, 'scheduled', ${OWNER_SUBQUERY})`,
       [program.rows[0].id]
     );
  } finally {
    await testPool.query("DELETE FROM clients WHERE id = $1", [client.rows[0].id]);
    await testPool.query(
      "DELETE FROM sessions WHERE session_date BETWEEN '2026-06-14' AND '2026-06-16'"
    );
  }
});

test("rejects attendance that uses another client's package", async () => {
  const db = await testPool.connect();

  try {
    await db.query("BEGIN");
    const program = await db.query(
      `SELECT id FROM programs
       WHERE type = 'one_on_one' AND trainer_user_id = (SELECT id FROM trainer_users ORDER BY id LIMIT 1)
       ORDER BY id LIMIT 1`
    );
    const clients = await db.query(
      `INSERT INTO clients (name, phone, trainer_user_id)
       VALUES
         ('Package Owner', '+27 82 000 2001', ${OWNER_SUBQUERY}),
         ('Wrong Attendee', '+27 82 000 2002', ${OWNER_SUBQUERY})
       RETURNING id`
    );
    const packageResult = await db.query(
      `INSERT INTO packages (
         client_id,
         program_id,
         sessions_total,
         price,
         purchase_date,
         expiry_date
       )
       VALUES ($1, $2, 4, 1520, '2026-06-01', '2026-08-01')
       RETURNING id`,
      [clients.rows[0].id, program.rows[0].id]
    );
    const session = await db.query(
      `INSERT INTO sessions (
         program_id,
         session_type,
         session_date,
         start_time,
         capacity,
         status,
         trainer_user_id
       )
       VALUES ($1, 'one_on_one', '2026-06-18', '09:00', 1, 'scheduled', ${OWNER_SUBQUERY})
       RETURNING id`,
      [program.rows[0].id]
    );

    await assert.rejects(
      db.query(
        `INSERT INTO session_attendance (session_id, client_id, package_id)
         VALUES ($1, $2, $3)`,
        [session.rows[0].id, clients.rows[1].id, packageResult.rows[0].id]
      ),
      (error) => error.code === "23503"
    );
  } finally {
    await db.query("ROLLBACK");
    db.release();
  }
});

test("rejects an approved booking linked to another client's request", async () => {
  const db = await testPool.connect();

  try {
    await db.query("BEGIN");
    const program = await db.query(
      `SELECT id FROM programs
       WHERE type = 'one_on_one' AND trainer_user_id = (SELECT id FROM trainer_users ORDER BY id LIMIT 1)
       ORDER BY id LIMIT 1`
    );
    const clients = await db.query(
      `INSERT INTO clients (name, phone, trainer_user_id)
       VALUES
         ('Request Owner', '+27 82 000 3001', ${OWNER_SUBQUERY}),
         ('Booking Owner', '+27 82 000 3002', ${OWNER_SUBQUERY})
       RETURNING id`
    );
    const packages = [];

    for (const client of clients.rows) {
      const packageResult = await db.query(
        `INSERT INTO packages (
           client_id,
           program_id,
           sessions_total,
           price,
           purchase_date,
           expiry_date
         )
         VALUES ($1, $2, 4, 1520, '2026-06-01', '2026-08-01')
         RETURNING id`,
        [client.id, program.rows[0].id]
      );
      packages.push(packageResult.rows[0]);
    }

    const request = await db.query(
      `INSERT INTO recurring_booking_requests (
         client_id,
         package_id,
         day_of_week,
         start_time,
         status,
         reviewed_at
       )
       VALUES ($1, $2, 1, '08:00', 'approved', NOW())
       RETURNING id`,
      [clients.rows[0].id, packages[0].id]
    );

    await assert.rejects(
      db.query(
        `INSERT INTO approved_recurring_bookings (
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
         VALUES ($1, $2, $3, $4, 'one_on_one', 2, '09:00', '2026-06-01', '2026-08-01')`,
        [
          request.rows[0].id,
          clients.rows[1].id,
          packages[1].id,
          program.rows[0].id
        ]
      ),
      (error) => error.code === "23503"
    );
  } finally {
    await db.query("ROLLBACK");
    db.release();
  }
});

test("rejects attendance beyond capacity and from another program", async () => {
  const db = await testPool.connect();

  try {
    await db.query("BEGIN");
    const oneOnOneProgram = await db.query(
      `SELECT id FROM programs
       WHERE type = 'one_on_one' AND trainer_user_id = (SELECT id FROM trainer_users ORDER BY id LIMIT 1)
       ORDER BY id LIMIT 1`
    );
    const groupProgram = await db.query(
      `SELECT id FROM programs
       WHERE type = 'group' AND trainer_user_id = (SELECT id FROM trainer_users ORDER BY id LIMIT 1)
       ORDER BY id LIMIT 1`
    );
    const clients = await db.query(
      `INSERT INTO clients (name, phone, trainer_user_id)
       VALUES
         ('Capacity Client One', '+27 82 000 4001', ${OWNER_SUBQUERY}),
         ('Capacity Client Two', '+27 82 000 4002', ${OWNER_SUBQUERY}),
         ('Program Client', '+27 82 000 4003', ${OWNER_SUBQUERY})
       RETURNING id`
    );
    const packages = [];

    for (const [index, client] of clients.rows.entries()) {
      const programId =
        index === 2 ? groupProgram.rows[0].id : oneOnOneProgram.rows[0].id;
      const packageResult = await db.query(
        `INSERT INTO packages (
           client_id,
           program_id,
           sessions_total,
           price,
           purchase_date,
           expiry_date
         )
         VALUES ($1, $2, 4, 1520, '2026-06-01', '2026-08-01')
         RETURNING id`,
        [client.id, programId]
      );
      packages.push(packageResult.rows[0]);
    }

    const session = await db.query(
      `INSERT INTO sessions (
         program_id,
         session_type,
         session_date,
         start_time,
         capacity,
         status,
         trainer_user_id
       )
       VALUES ($1, 'one_on_one', '2026-06-19', '08:00', 1, 'scheduled', ${OWNER_SUBQUERY})
       RETURNING id`,
      [oneOnOneProgram.rows[0].id]
    );

    await db.query(
      `INSERT INTO session_attendance (session_id, client_id, package_id)
       VALUES ($1, $2, $3)`,
      [session.rows[0].id, clients.rows[0].id, packages[0].id]
    );

    await db.query("SAVEPOINT capacity_check");
    await assert.rejects(
      db.query(
        `INSERT INTO session_attendance (session_id, client_id, package_id)
         VALUES ($1, $2, $3)`,
        [session.rows[0].id, clients.rows[1].id, packages[1].id]
      ),
      (error) => error.code === "23514"
    );
    await db.query("ROLLBACK TO SAVEPOINT capacity_check");

    await db.query("DELETE FROM session_attendance WHERE session_id = $1", [
      session.rows[0].id
    ]);

    await assert.rejects(
      db.query(
        `INSERT INTO session_attendance (session_id, client_id, package_id)
         VALUES ($1, $2, $3)`,
        [session.rows[0].id, clients.rows[2].id, packages[2].id]
      ),
      (error) => error.code === "23514"
    );
  } finally {
    await db.query("ROLLBACK");
    db.release();
  }
});

test("rejects session updates that conflict with existing attendance", async () => {
  const db = await testPool.connect();

  try {
    await db.query("BEGIN");
    const groupProgram = await db.query(
      `SELECT id FROM programs
       WHERE type = 'group' AND trainer_user_id = (SELECT id FROM trainer_users ORDER BY id LIMIT 1)
       ORDER BY id LIMIT 1`
    );
    const oneOnOneProgram = await db.query(
      `SELECT id FROM programs
       WHERE type = 'one_on_one' AND trainer_user_id = (SELECT id FROM trainer_users ORDER BY id LIMIT 1)
       ORDER BY id LIMIT 1`
    );
    const clients = await db.query(
      `INSERT INTO clients (name, phone, trainer_user_id)
       VALUES
         ('Update Client One', '+27 82 000 5001', ${OWNER_SUBQUERY}),
         ('Update Client Two', '+27 82 000 5002', ${OWNER_SUBQUERY})
       RETURNING id`
    );
    const packages = [];

    for (const client of clients.rows) {
      const packageResult = await db.query(
        `INSERT INTO packages (
           client_id,
           program_id,
           sessions_total,
           price,
           purchase_date,
           expiry_date
         )
         VALUES ($1, $2, 4, 1000, '2026-06-01', '2026-08-01')
         RETURNING id`,
        [client.id, groupProgram.rows[0].id]
      );
      packages.push(packageResult.rows[0]);
    }

    const session = await db.query(
      `INSERT INTO sessions (
         program_id,
         session_type,
         session_date,
         start_time,
         capacity,
         status,
         trainer_user_id
       )
       VALUES ($1, 'group', '2026-06-20', '08:00', 8, 'scheduled', ${OWNER_SUBQUERY})
       RETURNING id`,
      [groupProgram.rows[0].id]
    );

    await db.query(
      `INSERT INTO session_attendance (session_id, client_id, package_id)
       VALUES ($1, $2, $3), ($1, $4, $5)`,
      [
        session.rows[0].id,
        clients.rows[0].id,
        packages[0].id,
        clients.rows[1].id,
        packages[1].id
      ]
    );

    await db.query("SAVEPOINT capacity_update");
    await assert.rejects(
      db.query("UPDATE sessions SET capacity = 1 WHERE id = $1", [session.rows[0].id]),
      (error) => error.code === "23514"
    );
    await db.query("ROLLBACK TO SAVEPOINT capacity_update");

    await db.query("SAVEPOINT program_update");
    await assert.rejects(
      db.query(
        `UPDATE sessions
         SET program_id = $1, session_type = 'one_on_one', capacity = 1
         WHERE id = $2`,
        [oneOnOneProgram.rows[0].id, session.rows[0].id]
      ),
      (error) => error.code === "23514"
    );
    await db.query("ROLLBACK TO SAVEPOINT program_update");
  } finally {
    await db.query("ROLLBACK");
    db.release();
  }
});

test("rejects attendance linked to another client's recurring booking", async () => {
  const db = await testPool.connect();

  try {
    await db.query("BEGIN");
    const program = await db.query(
      `SELECT id FROM programs
       WHERE type = 'one_on_one' AND trainer_user_id = (SELECT id FROM trainer_users ORDER BY id LIMIT 1)
       ORDER BY id LIMIT 1`
    );
    const clients = await db.query(
      `INSERT INTO clients (name, phone, trainer_user_id)
       VALUES
         ('Recurring Owner', '+27 82 000 6001', ${OWNER_SUBQUERY}),
         ('Recurring Attendee', '+27 82 000 6002', ${OWNER_SUBQUERY})
       RETURNING id`
    );
    const packages = [];

    for (const client of clients.rows) {
      const packageResult = await db.query(
        `INSERT INTO packages (
           client_id,
           program_id,
           sessions_total,
           price,
           purchase_date,
           expiry_date
         )
         VALUES ($1, $2, 4, 1520, '2026-06-01', '2026-08-01')
         RETURNING id`,
        [client.id, program.rows[0].id]
      );
      packages.push(packageResult.rows[0]);
    }

    const request = await db.query(
      `INSERT INTO recurring_booking_requests (
         client_id,
         package_id,
         day_of_week,
         start_time,
         status,
         reviewed_at
       )
       VALUES ($1, $2, 1, '08:00', 'approved', NOW())
       RETURNING id`,
      [clients.rows[0].id, packages[0].id]
    );
    const recurringBooking = await db.query(
      `INSERT INTO approved_recurring_bookings (
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
       VALUES ($1, $2, $3, $4, 'one_on_one', 1, '08:00', '2026-06-01', '2026-08-01')
       RETURNING id`,
      [
        request.rows[0].id,
        clients.rows[0].id,
        packages[0].id,
        program.rows[0].id
      ]
    );
    const session = await db.query(
      `INSERT INTO sessions (
         program_id,
         session_type,
         session_date,
         start_time,
         capacity,
         status,
         trainer_user_id
       )
       VALUES ($1, 'one_on_one', '2026-06-22', '08:00', 1, 'scheduled', ${OWNER_SUBQUERY})
       RETURNING id`,
      [program.rows[0].id]
    );

    await assert.rejects(
      db.query(
        `INSERT INTO session_attendance (
           session_id,
           client_id,
           package_id,
           recurring_booking_id
         )
         VALUES ($1, $2, $3, $4)`,
        [
          session.rows[0].id,
          clients.rows[1].id,
          packages[1].id,
          recurringBooking.rows[0].id
        ]
      ),
      (error) => error.code === "23503"
    );
  } finally {
    await db.query("ROLLBACK");
    db.release();
  }
});

test("requires an approved request for recurring bookings", async () => {
  const db = await testPool.connect();

  try {
    await db.query("BEGIN");
    const program = await db.query(
      `SELECT id FROM programs
       WHERE type = 'one_on_one' AND trainer_user_id = (SELECT id FROM trainer_users ORDER BY id LIMIT 1)
       ORDER BY id LIMIT 1`
    );
    const client = await db.query(
      `INSERT INTO clients (name, phone, trainer_user_id)
       VALUES ('Approval State Client', '+27 82 000 7001', ${OWNER_SUBQUERY})
       RETURNING id`
    );
    const packageResult = await db.query(
      `INSERT INTO packages (
         client_id,
         program_id,
         sessions_total,
         price,
         purchase_date,
         expiry_date
       )
       VALUES ($1, $2, 4, 1520, '2026-06-01', '2026-08-01')
       RETURNING id`,
      [client.rows[0].id, program.rows[0].id]
    );
    const request = await db.query(
      `INSERT INTO recurring_booking_requests (
         client_id,
         package_id,
         day_of_week,
         start_time
       )
       VALUES ($1, $2, 1, '08:00')
       RETURNING id`,
      [client.rows[0].id, packageResult.rows[0].id]
    );

    await db.query("SAVEPOINT pending_request");
    await assert.rejects(
      db.query(
        `INSERT INTO approved_recurring_bookings (
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
         VALUES ($1, $2, $3, $4, 'one_on_one', 1, '08:00', '2026-06-01', '2026-08-01')`,
        [
          request.rows[0].id,
          client.rows[0].id,
          packageResult.rows[0].id,
          program.rows[0].id
        ]
      ),
      (error) => error.code === "23514"
    );
    await db.query("ROLLBACK TO SAVEPOINT pending_request");

    await db.query(
      `UPDATE recurring_booking_requests
       SET status = 'approved', reviewed_at = NOW()
       WHERE id = $1`,
      [request.rows[0].id]
    );
    await db.query(
      `INSERT INTO approved_recurring_bookings (
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
       VALUES ($1, $2, $3, $4, 'one_on_one', 1, '08:00', '2026-06-01', '2026-08-01')`,
      [
        request.rows[0].id,
        client.rows[0].id,
        packageResult.rows[0].id,
        program.rows[0].id
      ]
    );

    await assert.rejects(
      db.query(
        `UPDATE recurring_booking_requests
         SET status = 'rejected', reviewed_at = NOW()
         WHERE id = $1`,
        [request.rows[0].id]
      ),
      (error) => error.code === "23514"
    );
  } finally {
    await db.query("ROLLBACK");
    db.release();
  }
});

test("keeps attendance credit consumption consistent with status", async () => {
  const db = await testPool.connect();

  try {
    await db.query("BEGIN");
    const program = await db.query(
      `SELECT id FROM programs
       WHERE type = 'one_on_one' AND trainer_user_id = (SELECT id FROM trainer_users ORDER BY id LIMIT 1)
       ORDER BY id LIMIT 1`
    );
    const client = await db.query(
      `INSERT INTO clients (name, phone, trainer_user_id)
       VALUES ('Credit State Client', '+27 82 000 8001', ${OWNER_SUBQUERY})
       RETURNING id`
    );
    const packageResult = await db.query(
      `INSERT INTO packages (
         client_id,
         program_id,
         sessions_total,
         price,
         purchase_date,
         expiry_date
       )
       VALUES ($1, $2, 4, 1520, '2026-06-01', '2026-08-01')
       RETURNING id`,
      [client.rows[0].id, program.rows[0].id]
    );
    const session = await db.query(
      `INSERT INTO sessions (
         program_id,
         session_type,
         session_date,
         start_time,
         capacity,
         status,
         trainer_user_id
       )
       VALUES ($1, 'one_on_one', '2026-06-24', '08:00', 1, 'scheduled', ${OWNER_SUBQUERY})
       RETURNING id`,
      [program.rows[0].id]
    );

    for (const [status, creditConsumed] of [
      ["cancelled", true],
      ["completed", false],
      ["no_show", false],
      ["scheduled", true]
    ]) {
      await db.query("SAVEPOINT invalid_credit_state");
      await assert.rejects(
        db.query(
          `INSERT INTO session_attendance (
             session_id,
             client_id,
             package_id,
             status,
             credit_consumed
           )
           VALUES ($1, $2, $3, $4, $5)`,
          [
            session.rows[0].id,
            client.rows[0].id,
            packageResult.rows[0].id,
            status,
            creditConsumed
          ]
        ),
        (error) => error.code === "23514"
      );
      await db.query("ROLLBACK TO SAVEPOINT invalid_credit_state");
    }

    await db.query(
      `INSERT INTO session_attendance (
         session_id,
         client_id,
         package_id,
         status,
         credit_consumed
       )
       VALUES ($1, $2, $3, 'completed', true)`,
      [session.rows[0].id, client.rows[0].id, packageResult.rows[0].id]
    );
  } finally {
    await db.query("ROLLBACK");
    db.release();
  }
});

test("the overlap rule is per trainer, not per studio", async () => {
  // AUTH-04. sessions_no_overlap used to reject any two overlapping sessions
  // whatever, which made two trainers working at the same time impossible.
  const alice = await ensureTestTrainer(testPool, {
    email: "alice-schema@days4fitness.test",
    role: "trainer"
  });
  const bob = await ensureTestTrainer(testPool, {
    email: "bob-schema@days4fitness.test",
    role: "trainer"
  });
  // AUTH-10: each trainer books their own program, because sessions_owner_program
  // refuses a session whose program belongs to somebody else.
  const programs = new Map([
    [alice.id, await programFor(testPool, alice.id)],
    [bob.id, await programFor(testPool, bob.id)]
  ]);
  const book = (trainerId) =>
    testPool.query(
      `INSERT INTO sessions (
         program_id,
         session_type,
         session_date,
         start_time,
         capacity,
         status,
         trainer_user_id
       )
       VALUES ($1, 'one_on_one', '2026-06-22', '08:00', 1, 'scheduled', $2)
       RETURNING id`,
      [programs.get(trainerId), trainerId]
    );

  try {
    const hers = await book(alice.id);
    const his = await book(bob.id);
    assert.notEqual(hers.rows[0].id, his.rows[0].id, "both trainers may run at 08:00");

    // The same trainer twice is still a clash, and a partial overlap too.
    await assert.rejects(book(alice.id), (error) => error.code === "23P01");
    await assert.rejects(
      testPool.query(
        `INSERT INTO sessions (
           program_id,
           session_type,
           session_date,
           start_time,
           capacity,
           status,
           trainer_user_id
         )
         VALUES ($1, 'one_on_one', '2026-06-22', '08:30', 1, 'scheduled', $2)`,
        [programs.get(alice.id), alice.id]
      ),
      (error) => error.code === "23P01"
    );

    // Cancelling still frees the slot, for the trainer who cancelled.
    await testPool.query("UPDATE sessions SET status = 'cancelled' WHERE id = $1", [
      hers.rows[0].id
    ]);
    const again = await book(alice.id);
    assert.ok(again.rows[0].id);
  } finally {
    await testPool.query("DELETE FROM sessions WHERE session_date = '2026-06-22'");
  }
});
