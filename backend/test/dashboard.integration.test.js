import assert from "node:assert/strict";
import { after, test } from "node:test";
import pg from "pg";
import { env } from "../src/config/env.js";
import { createDashboardRepository } from "../src/repositories/dashboard.repository.js";
import { createDashboardService } from "../src/services/dashboard.service.js";

const { Pool } = pg;

if (!env.testDatabaseUrl || !new URL(env.testDatabaseUrl).pathname.toLowerCase().includes("test")) {
  throw new Error("Dashboard integration tests require a safe TEST_DATABASE_URL");
}

const testPool = new Pool({ connectionString: env.testDatabaseUrl });
const service = createDashboardService(createDashboardRepository(testPool));

after(async () => {
  await testPool.end();
});

async function createDashboardClient(
  suffix,
  { programType = "one_on_one", sessionsTotal, sessionsUsed, price, expiring = false, expired = false }
) {
  const stamp = `${Date.now()}-${Math.random()}`;
  const clientResult = await testPool.query(
    `INSERT INTO clients (name, phone, email)
     VALUES ($1, '+27 82 555 0700', $2)
     RETURNING id`,
    [`Dashboard ${suffix}`, `dashboard-${suffix}-${stamp}@example.com`]
  );
  const programResult = await testPool.query(
    "SELECT id FROM programs WHERE type = $1 ORDER BY id LIMIT 1",
    [programType]
  );
  const packageResult = await testPool.query(
    `INSERT INTO packages (
       client_id,
       program_id,
       sessions_total,
       sessions_used,
       price,
       purchase_date,
       expiry_date
     )
     VALUES (
       $1,
       $2,
       $3,
       $4,
       $5,
       CASE
         WHEN $7::boolean
           THEN (${todaySql()} - INTERVAL '2 months' - INTERVAL '1 day')::date
         WHEN $6::boolean
           THEN (${todaySql()} + INTERVAL '5 days' - INTERVAL '2 months')::date
         ELSE ${todaySql()}
       END,
       CASE
         WHEN $7::boolean
           THEN (${todaySql()} - INTERVAL '1 day')::date
         WHEN $6::boolean
           THEN (${todaySql()} + INTERVAL '5 days')::date
         ELSE (${todaySql()} + INTERVAL '2 months')::date
       END
     )
     RETURNING id`,
    [clientResult.rows[0].id, programResult.rows[0].id, sessionsTotal, sessionsUsed, price, expiring, expired]
  );
  return {
    clientId: clientResult.rows[0].id,
    packageId: packageResult.rows[0].id,
    programId: programResult.rows[0].id,
    programType
  };
}

function todaySql() {
  return "(CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Johannesburg')::date";
}

function previousTrainingDateSql() {
  return `CASE
    WHEN EXTRACT(DOW FROM ${todaySql()}) = 1
      THEN ${todaySql()} - INTERVAL '2 days'
    ELSE ${todaySql()} - INTERVAL '1 day'
  END`;
}

function currentOrNextTrainingDateSql() {
  return `CASE
    WHEN EXTRACT(DOW FROM ${todaySql()}) = 0
      THEN ${todaySql()} + INTERVAL '1 day'
    ELSE ${todaySql()}
  END`;
}

async function snapshot() {
  const overview = await service.getOverview();
  return overview.summary;
}

async function findAvailableTime(sessionDateSql) {
  const result = await testPool.query(
    `WITH candidate_times(start_time) AS (
       VALUES
         ('05:00'::time),
         ('06:00'::time),
         ('07:00'::time),
         ('08:00'::time),
         ('09:00'::time),
         ('10:00'::time),
         ('11:00'::time),
         ('12:00'::time),
         ('13:00'::time),
         ('14:00'::time),
         ('15:00'::time),
         ('16:00'::time),
         ('17:00'::time),
         ('18:00'::time)
     )
     SELECT candidate_times.start_time::text AS start_time
     FROM candidate_times
     WHERE NOT EXISTS (
       SELECT 1
       FROM sessions session
       WHERE session.session_date = ${sessionDateSql}
         AND session.start_time = candidate_times.start_time
         AND session.status <> 'cancelled'
     )
     ORDER BY candidate_times.start_time
     LIMIT 1`
  );
  return result.rows[0]?.start_time?.slice(0, 5) || "05:00";
}

test("returns dashboard reporting summaries from real PostgreSQL data", async () => {
  const isSundayResult = await testPool.query(
    `SELECT EXTRACT(DOW FROM ${todaySql()}) = 0 AS is_sunday`
  );
  const canCreateTodaySession = !isSundayResult.rows[0].is_sunday;
  const before = await snapshot();
  const createdClientIds = [];
  const createdSessionIds = [];

  try {
    const partial = await createDashboardClient("Partial", {
      programType: "group",
      sessionsTotal: 1,
      sessionsUsed: 0,
      price: 250
    });
    createdClientIds.push(partial.clientId);
    await testPool.query(
      `INSERT INTO package_payments (package_id, amount, payment_date, method)
       VALUES ($1, 100, ${todaySql()}, 'cash')`,
      [partial.packageId]
    );
    await testPool.query(
      `INSERT INTO package_payments (package_id, amount, payment_date, method)
       VALUES ($1, 50, ${todaySql()} + INTERVAL '3 days', 'eft')`,
      [partial.packageId]
    );
    const expired = await createDashboardClient("Expired", {
      sessionsTotal: 4,
      sessionsUsed: 1,
      price: 400,
      expired: true
    });
    createdClientIds.push(expired.clientId);
    await testPool.query(
      `INSERT INTO package_payments (package_id, amount, payment_date, method)
       VALUES ($1, 400, ${todaySql()} - INTERVAL '2 months', 'eft')`,
      [expired.packageId]
    );

    const expiring = await createDashboardClient("Expiring", {
      sessionsTotal: 4,
      sessionsUsed: 1,
      price: 1000,
      expiring: true
    });
    createdClientIds.push(expiring.clientId);
    const activeSessionDate = canCreateTodaySession ? todaySql() : currentOrNextTrainingDateSql();
    const activeSessionTime = await findAvailableTime(activeSessionDate);
    const activeSession = await testPool.query(
      `INSERT INTO sessions (
         program_id,
         session_type,
         session_date,
         start_time,
         capacity,
         status
       )
       VALUES ($1, $2, ${activeSessionDate}, $3::time, 1, 'scheduled')
       RETURNING id`,
      [expiring.programId, expiring.programType, activeSessionTime]
    );
    createdSessionIds.push(activeSession.rows[0].id);
    await testPool.query(
      `INSERT INTO session_attendance (session_id, client_id, package_id)
       VALUES ($1, $2, $3)`,
      [activeSession.rows[0].id, expiring.clientId, expiring.packageId]
    );
    const completedDate = previousTrainingDateSql();
    const completedTime = await findAvailableTime(completedDate);
    const completedSession = await testPool.query(
      `INSERT INTO sessions (
         program_id,
         session_type,
         session_date,
         start_time,
         capacity,
         status
       )
       VALUES ($1, $2, ${completedDate}, $3::time, 1, 'completed')
       RETURNING id`,
      [expiring.programId, expiring.programType, completedTime]
    );
    createdSessionIds.push(completedSession.rows[0].id);
    await testPool.query(
      `INSERT INTO session_attendance (
         session_id,
         client_id,
         package_id,
         status,
         credit_consumed
       )
       VALUES ($1, $2, $3, 'completed', true)`,
      [completedSession.rows[0].id, expiring.clientId, expiring.packageId]
    );

    const overview = await service.getOverview();
    const after = overview.summary;

    assert.equal(after.todaySessions, before.todaySessions + (canCreateTodaySession ? 1 : 0));
    assert.equal(after.completedSessions, before.completedSessions + 1);
    assert.equal(after.remainingSessions, before.remainingSessions + 4);
    assert.equal(after.unpaidPackages, before.unpaidPackages + 2);
    assert.equal(after.outstandingBalance, before.outstandingBalance + 1100);
    assert.equal(after.expiringPackages, before.expiringPackages + 1);
    assert.equal(after.monthRevenue, before.monthRevenue + 100);
    assert.equal(after.netRevenue, before.netRevenue + 550);
    if (canCreateTodaySession) {
      assert.ok(overview.todaySessions.some((session) => session.id === activeSession.rows[0].id));
    }
    assert.ok(overview.unpaidPackages.some((item) => item.clientId === partial.clientId));
    assert.ok(overview.expiringPackages.some((item) => item.clientId === expiring.clientId));

    const todaySessions = await service.getTodaySessions();
    if (canCreateTodaySession) {
      assert.ok(todaySessions.some((session) => session.id === activeSession.rows[0].id));
    }
  } finally {
    if (createdSessionIds.length > 0) {
      await testPool.query("DELETE FROM sessions WHERE id = ANY($1::bigint[])", [createdSessionIds]);
    }
    if (createdClientIds.length > 0) {
      await testPool.query("DELETE FROM clients WHERE id = ANY($1::bigint[])", [createdClientIds]);
    }
  }
});
