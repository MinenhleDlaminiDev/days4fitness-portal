// AUTH-06. The dashboard is the most likely place for a scoping mistake to
// survive, because a missed owner filter does not throw — it quietly adds
// another trainer's money to a total, and a total looks plausible whatever it
// contains. The revenue rollup read package_payments with no path to a client
// at all before this change.
//
// So the two trainers below are seeded with deliberately different,
// non-overlapping numbers: 3 credits and R500 against 11 credits and R1500.
// Matching values would hide exactly the bug being tested. Drop any of the
// owner predicates in dashboard.repository.js and these assertions fail.

import assert from "node:assert/strict";
import { after, test } from "node:test";
import pg from "pg";
import { env } from "../src/config/env.js";
import { createDashboardRepository } from "../src/repositories/dashboard.repository.js";
import { createDashboardService } from "../src/services/dashboard.service.js";
import { actorFor, ensureTestTrainer, programFor } from "./helpers/trainer.js";

const { Pool } = pg;

if (!env.testDatabaseUrl || !new URL(env.testDatabaseUrl).pathname.toLowerCase().includes("test")) {
  throw new Error("Dashboard scoping tests require a safe TEST_DATABASE_URL");
}

const testPool = new Pool({ connectionString: env.testDatabaseUrl });
const service = createDashboardService(createDashboardRepository(testPool));

const TODAY_SQL = "(CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Johannesburg')::date";

// Monday to Saturday only (sessions_training_day_check), and never today, so
// these fixtures cannot disturb the today-sessions count.
const PAST_TRAINING_DAY_SQL = `CASE
  WHEN EXTRACT(DOW FROM ${TODAY_SQL}) = 1
    THEN ${TODAY_SQL} - INTERVAL '2 days'
  ELSE ${TODAY_SQL} - INTERVAL '1 day'
END`;

const alice = await ensureTestTrainer(testPool, {
  email: "alice-dashboard@days4fitness.test",
  role: "trainer"
});
const bob = await ensureTestTrainer(testPool, {
  email: "bob-dashboard@days4fitness.test",
  role: "trainer"
});
// Criterion 6: a trainer with nothing at all must see zeroes, not errors and
// not somebody else's figures.
const newcomer = await ensureTestTrainer(testPool, {
  email: "carol-dashboard@days4fitness.test",
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

async function seedClient(trainer, label, { sessionsTotal, sessionsUsed, price, paid, expiring }) {
  const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const clientResult = await testPool.query(
    `INSERT INTO clients (name, phone, email, trainer_user_id)
     VALUES ($1, '+27 82 555 0900', $2, $3)
     RETURNING id`,
    [label, `auth06-${stamp}@example.com`, trainer.id]
  );
  const programId = await programFor(testPool, trainer.id);
  // Dates are computed in SQL, not in JavaScript: the expiry trigger measures
  // the window from the business clock, and the test machine's clock may be
  // on another date.
  const packageResult = await testPool.query(
    `INSERT INTO packages (
       client_id, program_id, sessions_total, sessions_used, price, purchase_date, expiry_date
     )
     VALUES (
       $1, $2, $3, $4, $5,
       CASE
         WHEN $6::boolean THEN (${TODAY_SQL} + INTERVAL '5 days' - INTERVAL '2 months')::date
         ELSE ${TODAY_SQL}
       END,
       CASE
         WHEN $6::boolean THEN (${TODAY_SQL} + INTERVAL '5 days')::date
         ELSE (${TODAY_SQL} + INTERVAL '2 months')::date
       END
     )
     RETURNING id`,
    [
      clientResult.rows[0].id,
      programId,
      sessionsTotal,
      sessionsUsed,
      price,
      Boolean(expiring)
    ]
  );
  if (paid > 0) {
    await testPool.query(
      `INSERT INTO package_payments (package_id, amount, payment_date, method)
       VALUES ($1, $2, ${TODAY_SQL}, 'cash')`,
      [packageResult.rows[0].id, paid]
    );
  }
  return {
    clientId: clientResult.rows[0].id,
    packageId: packageResult.rows[0].id,
    programId
  };
}

async function seedCompletedSession(trainer, seeded, startTime) {
  const sessionResult = await testPool.query(
    `INSERT INTO sessions (
       program_id, session_type, session_date, start_time, capacity, status, trainer_user_id
     )
     VALUES ($1, 'one_on_one', ${PAST_TRAINING_DAY_SQL}, $2::time, 1, 'completed', $3)
     RETURNING id`,
    [seeded.programId, startTime, trainer.id]
  );
  await testPool.query(
    `INSERT INTO session_attendance (session_id, client_id, package_id, status, credit_consumed)
     VALUES ($1, $2, $3, 'completed', true)`,
    [sessionResult.rows[0].id, seeded.clientId, seeded.packageId]
  );
  return sessionResult.rows[0].id;
}

test("a trainer's dashboard counts only their own clients, packages and payments", async () => {
  await clearFixtures();
  const before = (await service.getOverview(actorFor(businessAdmin))).summary;

  // Alice: 4 credits, one used, paid in full. 3 credits and R500.
  const aliceClient = await seedClient(alice, "Alice Only", {
    sessionsTotal: 4,
    sessionsUsed: 1,
    price: 500,
    paid: 500
  });
  await seedCompletedSession(alice, aliceClient, "05:00");

  // Bob: 8 credits with one used and R500 still owed, plus a 4-credit package
  // expiring this week. 11 credits and R1500.
  const bobClient = await seedClient(bob, "Bob Owing", {
    sessionsTotal: 8,
    sessionsUsed: 1,
    price: 1200,
    paid: 700
  });
  // The same slot as Alice's: the overlap rule is per trainer since AUTH-04,
  // so this also proves the two dashboards are reading separate sessions.
  await seedCompletedSession(bob, bobClient, "05:00");
  const bobExpiring = await seedClient(bob, "Bob Expiring", {
    sessionsTotal: 4,
    sessionsUsed: 0,
    price: 800,
    paid: 800,
    expiring: true
  });

  const aliceView = await service.getOverview(actorFor(alice));
  const bobView = await service.getOverview(actorFor(bob));

  assert.deepEqual(
    aliceView.summary,
    {
      todaySessions: 0,
      completedSessions: 1,
      remainingSessions: 3,
      unpaidPackages: 0,
      outstandingBalance: 0,
      expiringPackages: 0,
      monthRevenue: 500,
      netRevenue: 500
    },
    "Alice sees her own figures and none of Bob's"
  );
  assert.deepEqual(
    bobView.summary,
    {
      todaySessions: 0,
      completedSessions: 1,
      remainingSessions: 11,
      unpaidPackages: 1,
      outstandingBalance: 500,
      expiringPackages: 1,
      monthRevenue: 1500,
      netRevenue: 1500
    },
    "Bob sees his own figures and none of Alice's"
  );

  // The lists, not just the totals.
  assert.deepEqual(aliceView.unpaidPackages, []);
  assert.deepEqual(aliceView.expiringPackages, []);
  assert.deepEqual(
    bobView.unpaidPackages.map((row) => row.clientId),
    [bobClient.clientId]
  );
  assert.deepEqual(
    bobView.expiringPackages.map((row) => row.clientId),
    [bobExpiring.clientId]
  );

  // Criterion 6: nothing seeded means zeroes, not an error.
  const newcomerView = await service.getOverview(actorFor(newcomer));
  assert.deepEqual(newcomerView.summary, {
    todaySessions: 0,
    completedSessions: 0,
    remainingSessions: 0,
    unpaidPackages: 0,
    outstandingBalance: 0,
    expiringPackages: 0,
    monthRevenue: 0,
    netRevenue: 0
  });
  assert.deepEqual(newcomerView.todaySessions, []);
  assert.deepEqual(newcomerView.unpaidPackages, []);
  assert.deepEqual(newcomerView.expiringPackages, []);

  // An admin still sees the business, which is the reason admins exist here:
  // both trainers' figures, added together.
  const after = (await service.getOverview(actorFor(businessAdmin))).summary;
  assert.equal(after.completedSessions, before.completedSessions + 2);
  assert.equal(after.remainingSessions, before.remainingSessions + 14);
  assert.equal(after.unpaidPackages, before.unpaidPackages + 1);
  assert.equal(after.outstandingBalance, before.outstandingBalance + 500);
  assert.equal(after.expiringPackages, before.expiringPackages + 1);
  assert.equal(after.monthRevenue, before.monthRevenue + 2000);
  assert.equal(after.netRevenue, before.netRevenue + 2000);
});

test("today's sessions are the trainer's own", async () => {
  await clearFixtures();
  const isSunday = (await testPool.query(`SELECT EXTRACT(DOW FROM ${TODAY_SQL}) = 0 AS yes`))
    .rows[0].yes;
  if (isSunday) return;

  const aliceClient = await seedClient(alice, "Alice Today", {
    sessionsTotal: 4,
    sessionsUsed: 0,
    price: 500,
    paid: 0
  });
  const aliceSession = await testPool.query(
    `INSERT INTO sessions (
       program_id, session_type, session_date, start_time, capacity, status, trainer_user_id
     )
     VALUES ($1, 'one_on_one', ${TODAY_SQL}, '06:00'::time, 1, 'scheduled', $2)
     RETURNING id`,
    [aliceClient.programId, alice.id]
  );
  await testPool.query(
    `INSERT INTO session_attendance (session_id, client_id, package_id)
     VALUES ($1, $2, $3)`,
    [aliceSession.rows[0].id, aliceClient.clientId, aliceClient.packageId]
  );

  const aliceToday = await service.getTodaySessions(actorFor(alice));
  const bobToday = await service.getTodaySessions(actorFor(bob));

  assert.deepEqual(
    aliceToday.map((session) => session.id),
    [aliceSession.rows[0].id]
  );
  assert.deepEqual(bobToday, [], "Bob's day does not contain Alice's session");
  assert.ok(
    (await service.getTodaySessions(actorFor(businessAdmin))).some(
      (session) => session.id === aliceSession.rows[0].id
    ),
    "the admin still sees every trainer's day"
  );
});

test("a dashboard cannot be built without an acting trainer", async () => {
  await assert.rejects(service.getOverview(), (error) => error.status === 401);
  await assert.rejects(service.getTodaySessions(), (error) => error.status === 401);
});
