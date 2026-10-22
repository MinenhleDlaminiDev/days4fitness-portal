// AUTH-06. The reports summary read package_payments on its own, with no
// path to a client, so every trainer was shown the whole business's income.
// The session counts read sessions unfiltered.
//
// The two trainers below are seeded with deliberately different,
// non-overlapping numbers: 4 sessions and R500 against 9 sessions and R1200.
// The no-show counts differ too, because a rate computed over the wrong
// population is wrong even when the numerator is right — if the denominator
// leaked, Alice's completion rate would be the business's 90.9% instead of
// her own 75%.

import assert from "node:assert/strict";
import { after, test } from "node:test";
import pg from "pg";
import { env } from "../src/config/env.js";
import { createReportsRepository } from "../src/repositories/reports.repository.js";
import { createReportsService } from "../src/services/reports.service.js";
import { addDays, addMonths, upcomingMonday } from "./helpers/dates.js";
import { actorFor, ensureTestTrainer } from "./helpers/trainer.js";

const { Pool } = pg;

if (!env.testDatabaseUrl || !new URL(env.testDatabaseUrl).pathname.toLowerCase().includes("test")) {
  throw new Error("Reports scoping tests require a safe TEST_DATABASE_URL");
}

const testPool = new Pool({ connectionString: env.testDatabaseUrl });
const service = createReportsService(createReportsRepository(testPool));

// A private window, far enough out to clear the sessions suite (which books
// up to 24 days past upcomingMonday(7)) and the other reports suite (49).
const WEEK = upcomingMonday(70);
const day = (offset) => addDays(WEEK, offset);

const alice = await ensureTestTrainer(testPool, {
  email: "alice-reports@days4fitness.test",
  role: "trainer"
});
const bob = await ensureTestTrainer(testPool, {
  email: "bob-reports@days4fitness.test",
  role: "trainer"
});
const newcomer = await ensureTestTrainer(testPool, {
  email: "carol-reports@days4fitness.test",
  role: "trainer"
});
const businessAdmin = await ensureTestTrainer(testPool);

/** These trainers outlive a run, so their fixtures are cleared either side. */
async function clearFixtures() {
  for (const trainer of [alice, bob, newcomer]) {
    await testPool.query("DELETE FROM clients WHERE trainer_user_id = $1", [trainer.id]);
    await testPool.query("DELETE FROM sessions WHERE trainer_user_id = $1", [trainer.id]);
  }
}

after(async () => {
  await clearFixtures();
  await testPool.end();
});

// Shared across both trainers so no two fixtures land on the same slot, even
// though the overlap rule is per trainer since AUTH-04.
let nextSlot = 0;

async function seedClient(trainer, name, { completed = 0, noShow = 0, cancelled = 0, paid = 0 }) {
  const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const clientResult = await testPool.query(
    `INSERT INTO clients (name, phone, email, trainer_user_id)
     VALUES ($1, '+27 82 555 0400', $2, $3)
     RETURNING id`,
    [name, `auth06-reports-${stamp}@example.com`, trainer.id]
  );
  const clientId = clientResult.rows[0].id;
  const programResult = await testPool.query(
    "SELECT id FROM programs WHERE type = 'one_on_one' ORDER BY id LIMIT 1"
  );
  const programId = programResult.rows[0].id;
  const packageResult = await testPool.query(
    `INSERT INTO packages (client_id, program_id, sessions_total, price, purchase_date, expiry_date)
     VALUES ($1, $2, 16, 5600, $3::date, $4::date)
     RETURNING id`,
    [clientId, programId, day(0), addMonths(day(0), 2)]
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
    // Monday to Saturday only, 05:00 to 18:00, one attendance per slot.
    const sessionDate = day(Math.floor(nextSlot / 14) % 6);
    const startTime = `${String(5 + (nextSlot % 14)).padStart(2, "0")}:00`;
    nextSlot += 1;
    const sessionResult = await testPool.query(
      `INSERT INTO sessions (
         program_id, session_type, session_date, start_time, capacity, status, trainer_user_id
       )
       VALUES ($1, 'one_on_one', $2::date, $3::time, 1, $4, $5)
       RETURNING id`,
      [programId, sessionDate, startTime, status, trainer.id]
    );
    await testPool.query(
      `INSERT INTO session_attendance (session_id, client_id, package_id, status, credit_consumed)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        sessionResult.rows[0].id,
        clientId,
        packageId,
        status,
        status === "completed" || status === "no_show"
      ]
    );
  };

  for (let i = 0; i < completed; i += 1) await place("completed");
  for (let i = 0; i < noShow; i += 1) await place("no_show");
  for (let i = 0; i < cancelled; i += 1) await place("cancelled");

  return clientId;
}

test("a trainer's report covers only their own revenue, sessions and clients", async () => {
  await clearFixtures();
  const range = { from: day(0), to: day(6) };
  const before = await service.getReport(range, actorFor(businessAdmin));

  const aliceClient = await seedClient(alice, "Alice Reports Client", {
    completed: 3,
    noShow: 1,
    paid: 500
  });
  const bobClient = await seedClient(bob, "Bob Reports Client", {
    completed: 7,
    cancelled: 2,
    paid: 1200
  });

  const aliceReport = await service.getReport(range, actorFor(alice));
  const bobReport = await service.getReport(range, actorFor(bob));

  assert.equal(aliceReport.revenue, 500, "Alice's revenue is hers, not the business's");
  assert.deepEqual(aliceReport.sessions, {
    total: 4,
    completed: 3,
    noShow: 1,
    cancelled: 0,
    scheduled: 0
  });
  assert.equal(aliceReport.attendance.total, 4);
  assert.equal(aliceReport.attendance.completed, 3);
  assert.equal(aliceReport.attendance.noShow, 1);
  // 3 of her own 4 resolved attendances. Over the combined population it
  // would be 10 of 11, or 90.9%.
  assert.equal(aliceReport.attendance.completionRate, 75);
  assert.deepEqual(
    aliceReport.clients.map((row) => row.id),
    [aliceClient],
    "Bob's client is not in Alice's breakdown"
  );

  assert.equal(bobReport.revenue, 1200);
  assert.deepEqual(bobReport.sessions, {
    total: 9,
    completed: 7,
    noShow: 0,
    cancelled: 2,
    scheduled: 0
  });
  assert.equal(bobReport.attendance.completionRate, 100);
  assert.deepEqual(
    bobReport.clients.map((row) => row.id),
    [bobClient]
  );

  // Criterion 6: a trainer with nothing gets zeroes, not an error.
  const newcomerReport = await service.getReport(range, actorFor(newcomer));
  assert.equal(newcomerReport.revenue, 0);
  assert.equal(newcomerReport.sessions.total, 0);
  assert.equal(newcomerReport.attendance.completionRate, null);
  assert.deepEqual(newcomerReport.clients, []);

  // The admin still sees the business: both trainers added together.
  const after = await service.getReport(range, actorFor(businessAdmin));
  assert.equal(after.revenue, before.revenue + 1700);
  assert.equal(after.sessions.total, before.sessions.total + 13);
  assert.equal(after.sessions.completed, before.sessions.completed + 10);
  assert.equal(after.sessions.cancelled, before.sessions.cancelled + 2);
  assert.equal(after.attendance.completed, before.attendance.completed + 10);
  assert.equal(after.attendance.noShow, before.attendance.noShow + 1);
  const adminClientIds = after.clients.map((row) => row.id);
  assert.ok(adminClientIds.includes(aliceClient));
  assert.ok(adminClientIds.includes(bobClient));
});

test("a report cannot be built without an acting trainer", async () => {
  await assert.rejects(
    service.getReport({ from: day(0), to: day(6) }),
    (error) => error.status === 401
  );
});
