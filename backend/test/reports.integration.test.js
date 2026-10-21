import assert from "node:assert/strict";
import { after, test } from "node:test";
import pg from "pg";
import { env } from "../src/config/env.js";
import { createReportsRepository } from "../src/repositories/reports.repository.js";
import { createReportsService } from "../src/services/reports.service.js";
import { addDays, addMonths, daysFromToday, upcomingMonday } from "./helpers/dates.js";
import { ensureTestTrainer, OWNER_SUBQUERY } from "./helpers/trainer.js";

const { Pool } = pg;

if (!env.testDatabaseUrl || !new URL(env.testDatabaseUrl).pathname.toLowerCase().includes("test")) {
  throw new Error("Reports integration tests require a safe TEST_DATABASE_URL");
}

const testPool = new Pool({ connectionString: env.testDatabaseUrl });

// Fixtures own their clients since AUTH-03, so the suite needs a trainer
// for them to belong to. Top-level await, so it is done before any test runs.
await ensureTestTrainer(testPool);
const service = createReportsService(createReportsRepository(testPool));

// A private window, so the assertions are exact rather than "greater than
// whatever else is in the database". It must also clear the sessions suite,
// which anchors on upcomingMonday() and books up to 24 days past it — when the
// suite runs on a Monday those windows coincide exactly. 49 days out stays
// clear of that and still falls inside the two-month package expiry below.
const WEEK = upcomingMonday(49);
const day = (offset) => addDays(WEEK, offset);
const createdClientIds = [];
let nextSlot = 0;

async function seedClient(name, { completed = 0, noShow = 0, cancelled = 0, paid = 0 }) {
  const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const clientResult = await testPool.query(
    `INSERT INTO clients (name, phone, email, trainer_user_id)
     VALUES ($1, '+27 82 555 0300', $2, ${OWNER_SUBQUERY}) RETURNING id`,
    [name, `reports-${stamp}@example.com`]
  );
  const clientId = clientResult.rows[0].id;
  createdClientIds.push(clientId);

  const programResult = await testPool.query(
    "SELECT id FROM programs WHERE type = 'one_on_one' ORDER BY id LIMIT 1"
  );
  const programId = programResult.rows[0].id;
  const purchaseDate = daysFromToday(0);
  const packageResult = await testPool.query(
    `INSERT INTO packages (client_id, program_id, sessions_total, price, purchase_date, expiry_date)
     VALUES ($1, $2, 16, 5600, $3::date, $4::date) RETURNING id`,
    [clientId, programId, purchaseDate, addMonths(purchaseDate, 2)]
  );
  const packageId = packageResult.rows[0].id;

  if (paid > 0) {
    await testPool.query(
      `INSERT INTO package_payments (package_id, amount, payment_date, method)
       VALUES ($1, $2, $3::date, 'cash')`,
      [packageId, paid, day(0)]
    );
  }

  const place = async (status) => {
    // Every attendance needs its own slot: the active-slot index is unique on
    // (date, time) for anything not cancelled. nextSlot is shared across
    // clients so two of them never land on the same one. Only Monday to
    // Saturday are valid training days, so the day index stops at 5.
    const sessionDate = day(Math.floor(nextSlot / 14) % 6);
    const startTime = `${String(5 + (nextSlot % 14)).padStart(2, "0")}:00`;
    nextSlot += 1;
    const sessionResult = await testPool.query(
      `INSERT INTO sessions (program_id, session_type, session_date, start_time, capacity, status)
       VALUES ($1, 'one_on_one', $2::date, $3::time, 1, $4) RETURNING id`,
      [programId, sessionDate, startTime, status === "cancelled" ? "cancelled" : status]
    );
    await testPool.query(
      `INSERT INTO session_attendance (session_id, client_id, package_id, status, credit_consumed)
       VALUES ($1, $2, $3, $4, $5)`,
      [sessionResult.rows[0].id, clientId, packageId, status, status === "completed" || status === "no_show"]
    );
  };

  for (let i = 0; i < completed; i += 1) await place("completed");
  for (let i = 0; i < noShow; i += 1) await place("no_show");
  for (let i = 0; i < cancelled; i += 1) await place("cancelled");

  return clientId;
}

after(async () => {
  if (createdClientIds.length > 0) {
    await testPool.query("DELETE FROM clients WHERE id = ANY($1::bigint[])", [createdClientIds]);
    await testPool.query(
      `DELETE FROM sessions session
       WHERE NOT EXISTS (
         SELECT 1 FROM session_attendance attendance WHERE attendance.session_id = session.id
       )`
    );
  }
  await testPool.end();
});

test("aggregates revenue, session outcomes and per-client totals for a range", async () => {
  await seedClient("Reports Busy", { completed: 4, noShow: 1, cancelled: 2, paid: 3000 });
  await seedClient("Reports Quiet", { completed: 1, noShow: 0, cancelled: 0, paid: 500 });

  const report = await service.getReport({ from: day(0), to: day(6) });

  assert.equal(report.revenue, 3500, "revenue sums payments in the range");
  assert.equal(report.sessions.completed, 5);
  assert.equal(report.sessions.noShow, 1);
  assert.equal(report.sessions.cancelled, 2);
  assert.equal(report.attendance.completed, 5);
  assert.equal(report.attendance.noShow, 1);
  // 5 of 6 resolved attendances were completed.
  assert.equal(report.attendance.completionRate, 83.3);

  const busy = report.clients.find((row) => row.name === "Reports Busy");
  const quiet = report.clients.find((row) => row.name === "Reports Quiet");
  assert.equal(busy.sessionsCompleted, 4);
  assert.equal(busy.sessionsNoShow, 1);
  assert.equal(busy.sessionsCancelled, 2);
  assert.equal(busy.sessionsBooked, 7);
  assert.equal(busy.amountPaid, 3000);
  assert.equal(quiet.amountPaid, 500);
  assert.ok(
    report.clients.indexOf(busy) < report.clients.indexOf(quiet),
    "clients are ordered by what they paid"
  );
});

test("a range before the data returns zeroes and no clients", async () => {
  const report = await service.getReport({ from: day(-21), to: day(-15) });

  assert.equal(report.revenue, 0);
  assert.equal(report.sessions.total, 0);
  assert.equal(report.attendance.completionRate, null);
  assert.deepEqual(report.clients, []);
});
