import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { env } from "../src/config/env.js";
import { applyMigrations } from "../src/db/migrationRunner.js";

const { Pool } = pg;
const migrationsDirectory = fileURLToPath(
  new URL("../../database/migrations", import.meta.url)
);

if (!env.testDatabaseUrl || !new URL(env.testDatabaseUrl).pathname.toLowerCase().includes("test")) {
  throw new Error("Integration tests require a safe TEST_DATABASE_URL");
}

const testPool = new Pool({ connectionString: env.testDatabaseUrl });

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

  assert.deepEqual(
    before.rows.map((row) => row.filename),
    [
      "001_init.sql",
      "002_pricing_seed.sql",
      "003_clients_preferred_days.sql",
      "004_clients_preferred_schedule.sql",
      "005_scheduling_data_model.sql",
      "006_scheduling_integrity.sql",
      "007_scheduling_relationship_integrity.sql",
      "008_session_update_integrity.sql",
      "009_scheduling_state_integrity.sql"
    ]
  );
  assert.deepEqual(appliedAgain, []);
});

test("creates the Phase 2 scheduling schema and defaults", async () => {
  const settings = await testPool.query(
    "SELECT group_capacity, session_duration_minutes FROM scheduling_settings WHERE id = 1"
  );
  const sessionColumns = await testPool.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'sessions'`
  );
  const columnNames = new Set(sessionColumns.rows.map((row) => row.column_name));

  assert.deepEqual(settings.rows[0], {
    group_capacity: 8,
    session_duration_minutes: 60
  });
  assert.equal(columnNames.has("session_type"), true);
  assert.equal(columnNames.has("status"), true);
  assert.equal(columnNames.has("rescheduled_from_session_id"), true);
  assert.equal(columnNames.has("client_id"), false);
  assert.equal(columnNames.has("package_id"), false);
  assert.equal(columnNames.has("completed"), false);
});

test("allows multiple clients to attend one group session", async () => {
  const db = await testPool.connect();

  try {
    await db.query("BEGIN");
    const program = await db.query(
      "SELECT id FROM programs WHERE type = 'group' ORDER BY id LIMIT 1"
    );
    const clients = await db.query(
      `INSERT INTO clients (name, phone)
       VALUES
         ('Group Client One', '+27 82 000 1001'),
         ('Group Client Two', '+27 82 000 1002')
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
         status
       )
       VALUES ($1, 'group', '2026-06-17', '09:00', 8, 'scheduled')
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
      `INSERT INTO clients (name, phone, preferred_days, preferred_schedule)
       VALUES (
         'Legacy Client',
         '+27 82 111 2222',
         ARRAY['Monday', 'Saturday'],
         '{"Monday":["08:00"],"Saturday":["10:00"]}'::jsonb
       )
       RETURNING id`
    );
    const programResult = await db.query(
      "SELECT id FROM programs WHERE name = 'Weight Loss' AND type = 'one_on_one'"
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
      [clientResult.rows[0].id, programResult.rows[0].id]
    );
    const sessionResult = await db.query(
      `INSERT INTO sessions (package_id, client_id, session_date, start_time, completed)
       VALUES ($1, $2, '2026-06-15', '08:00', true)
       RETURNING id`,
      [packageResult.rows[0].id, clientResult.rows[0].id]
    );

    await applyMigrations(db, () => {});

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
    assert.deepEqual(
      appliedMigrations.rows.map((row) => row.filename),
      [
        "001_init.sql",
        "002_pricing_seed.sql",
        "003_clients_preferred_days.sql",
        "004_clients_preferred_schedule.sql",
        "005_scheduling_data_model.sql",
        "006_scheduling_integrity.sql",
        "007_scheduling_relationship_integrity.sql",
        "008_session_update_integrity.sql",
        "009_scheduling_state_integrity.sql"
      ]
    );
  } finally {
    await db.query("SET search_path TO public");
    await db.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    db.release();
  }
});

test("enforces training-day, status, and active-slot constraints", async () => {
  const client = await testPool.query(
    `INSERT INTO clients (name, phone)
     VALUES ('Phase 2 Constraint Client', '+27 82 333 4444')
     RETURNING id`
  );

  try {
    const program = await testPool.query(
      "SELECT id FROM programs WHERE type = 'one_on_one' ORDER BY id LIMIT 1"
    );

    await assert.rejects(
      testPool.query(
        `INSERT INTO sessions (
           program_id,
           session_type,
           session_date,
           start_time,
           capacity,
           status
         )
         VALUES ($1, 'one_on_one', '2026-06-14', '08:00', 1, 'scheduled')`,
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
         status
       )
       VALUES ($1, 'one_on_one', '2026-06-15', '08:00', 1, 'scheduled')
       RETURNING id`,
      [program.rows[0].id]
    );

    await assert.rejects(
      testPool.query(
        `INSERT INTO sessions (
           program_id,
           session_type,
           session_date,
           start_time,
           capacity,
           status
         )
         VALUES ($1, 'one_on_one', '2026-06-15', '08:00', 1, 'scheduled')`,
        [program.rows[0].id]
      ),
      (error) => error.code === "23505"
    );

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
         rescheduled_from_session_id
       )
       VALUES ($1, 'one_on_one', '2026-06-16', '08:00', 1, 'scheduled', $2)`,
      [program.rows[0].id, session.rows[0].id]
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
      "SELECT id FROM programs WHERE type = 'one_on_one' ORDER BY id LIMIT 1"
    );
    const clients = await db.query(
      `INSERT INTO clients (name, phone)
       VALUES
         ('Package Owner', '+27 82 000 2001'),
         ('Wrong Attendee', '+27 82 000 2002')
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
         status
       )
       VALUES ($1, 'one_on_one', '2026-06-18', '09:00', 1, 'scheduled')
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
      "SELECT id FROM programs WHERE type = 'one_on_one' ORDER BY id LIMIT 1"
    );
    const clients = await db.query(
      `INSERT INTO clients (name, phone)
       VALUES
         ('Request Owner', '+27 82 000 3001'),
         ('Booking Owner', '+27 82 000 3002')
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
      "SELECT id FROM programs WHERE type = 'one_on_one' ORDER BY id LIMIT 1"
    );
    const groupProgram = await db.query(
      "SELECT id FROM programs WHERE type = 'group' ORDER BY id LIMIT 1"
    );
    const clients = await db.query(
      `INSERT INTO clients (name, phone)
       VALUES
         ('Capacity Client One', '+27 82 000 4001'),
         ('Capacity Client Two', '+27 82 000 4002'),
         ('Program Client', '+27 82 000 4003')
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
         status
       )
       VALUES ($1, 'one_on_one', '2026-06-19', '08:00', 1, 'scheduled')
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
      "SELECT id FROM programs WHERE type = 'group' ORDER BY id LIMIT 1"
    );
    const oneOnOneProgram = await db.query(
      "SELECT id FROM programs WHERE type = 'one_on_one' ORDER BY id LIMIT 1"
    );
    const clients = await db.query(
      `INSERT INTO clients (name, phone)
       VALUES
         ('Update Client One', '+27 82 000 5001'),
         ('Update Client Two', '+27 82 000 5002')
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
         status
       )
       VALUES ($1, 'group', '2026-06-20', '08:00', 8, 'scheduled')
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
      "SELECT id FROM programs WHERE type = 'one_on_one' ORDER BY id LIMIT 1"
    );
    const clients = await db.query(
      `INSERT INTO clients (name, phone)
       VALUES
         ('Recurring Owner', '+27 82 000 6001'),
         ('Recurring Attendee', '+27 82 000 6002')
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
         status
       )
       VALUES ($1, 'one_on_one', '2026-06-22', '08:00', 1, 'scheduled')
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
      "SELECT id FROM programs WHERE type = 'one_on_one' ORDER BY id LIMIT 1"
    );
    const client = await db.query(
      `INSERT INTO clients (name, phone)
       VALUES ('Approval State Client', '+27 82 000 7001')
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
      "SELECT id FROM programs WHERE type = 'one_on_one' ORDER BY id LIMIT 1"
    );
    const client = await db.query(
      `INSERT INTO clients (name, phone)
       VALUES ('Credit State Client', '+27 82 000 8001')
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
         status
       )
       VALUES ($1, 'one_on_one', '2026-06-24', '08:00', 1, 'scheduled')
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
