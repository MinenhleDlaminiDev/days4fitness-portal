import assert from "node:assert/strict";
import { after, test } from "node:test";
import pg from "pg";
import { env } from "../src/config/env.js";
import { createBookingRequestsRepository } from "../src/repositories/bookingRequests.repository.js";
import { createClientsRepository } from "../src/repositories/clients.repository.js";
import { createSessionsRepository } from "../src/repositories/sessions.repository.js";
import { createBookingRequestsService } from "../src/services/bookingRequests.service.js";
import { createClientsService } from "../src/services/clients.service.js";
import {
  actorFor,
  bindActor,
  bindSessionsActor,
  ensureTestTrainer
} from "./helpers/trainer.js";
import { createSessionsService } from "../src/services/sessions.service.js";
import { addDays, addMonths, daysFromToday, upcomingMonday } from "./helpers/dates.js";

const { Pool } = pg;

// Derived from today so the fixtures never fall into the past. PURCHASE_DATE
// feeds the exact two-month expiry constraint on packages.
const PURCHASE_DATE = daysFromToday(0);
const EXPIRY_DATE = addMonths(PURCHASE_DATE, 2);
const WEEK_ONE_MONDAY = upcomingMonday();
const day = (offset) => addDays(WEEK_ONE_MONDAY, offset);

if (!env.testDatabaseUrl || !new URL(env.testDatabaseUrl).pathname.toLowerCase().includes("test")) {
  throw new Error("Integration tests require a safe TEST_DATABASE_URL");
}

const testPool = new Pool({ connectionString: env.testDatabaseUrl });
// Clients belong to a trainer since AUTH-03, so the suite seeds one and acts
// as it. Isolation between two trainers is tested separately, below.
const trainer = await ensureTestTrainer(testPool);
const service = bindActor(
  createClientsService(createClientsRepository(testPool)),
  actorFor(trainer)
);
const requestsService = createBookingRequestsService(createBookingRequestsRepository(testPool));
const sessionsService = bindSessionsActor(
  createSessionsService(createSessionsRepository(testPool)),
  actorFor(trainer)
);

after(async () => {
  await testPool.end();
});

test("creates and reads a client through the PostgreSQL repository", async () => {
  const email = `integration-${Date.now()}@example.com`;

  try {
    const created = await service.createClient({
      name: "Integration Client",
      phone: "+27 82 999 0000",
      email,
      program: "Weight Loss",
      sessionType: "One-on-One",
      packageSize: 4,
      purchaseDate: PURCHASE_DATE,
      paid: false
    });

    const stored = await service.getClient(created.id);
    const packageResult = await testPool.query(
      `SELECT
         sessions_total,
         paid,
         purchase_date::text AS purchase_date,
         expiry_date::text AS expiry_date
       FROM packages
       WHERE client_id = $1`,
      [created.id]
    );

    assert.equal(stored.email, email);
    assert.deepEqual(stored.preferredDays, []);
    assert.equal(stored.purchaseDate, PURCHASE_DATE);
    assert.equal(stored.expiryDate, EXPIRY_DATE);
    assert.equal(packageResult.rows[0].sessions_total, 4);
    assert.equal(packageResult.rows[0].paid, false);
    assert.equal(packageResult.rows[0].purchase_date, PURCHASE_DATE);
    assert.equal(packageResult.rows[0].expiry_date, EXPIRY_DATE);
  } finally {
    await testPool.query("DELETE FROM clients WHERE email = $1", [email]);
  }
});

test("updates, filters, archives, and restores a client", async () => {
  const stamp = Date.now();
  const email = `management-${stamp}@example.com`;
  const updatedEmail = `managed-${stamp}@example.com`;

  try {
    const created = await service.createClient({
      name: "Management Client",
      phone: "+27 82 999 0001",
      email,
      program: "Weight Loss",
      sessionType: "One-on-One",
      packageSize: 4,
      purchaseDate: PURCHASE_DATE,
      paid: false
    });

    const updated = await service.updateClient(created.id, {
      name: "Managed Client",
      phone: "+27 82 999 0002",
      email: updatedEmail,
      preferredDays: ["Tuesday"],
      preferredSchedule: { Tuesday: ["09:00"] }
    });
    assert.equal(updated.name, "Managed Client");
    assert.equal(updated.email, updatedEmail);
    assert.deepEqual(updated.preferredSchedule, { Tuesday: ["09:00"] });
    const pendingRequest = (await requestsService.listPending()).find(
      (request) => request.clientId === created.id
    );
    await requestsService.approve(pendingRequest.id);

    const searchResult = await service.listClients({
      search: updatedEmail,
      status: "active",
      packageStatus: "active",
      page: 1,
      pageSize: 1
    });
    assert.equal(searchResult.pagination.total, 1);
    assert.equal(searchResult.summary.unpaid, 1);
    assert.equal(searchResult.items[0].id, created.id);

    const packageHistory = await service.getPackageHistory(created.id);
    assert.equal(packageHistory.length, 1);
    assert.equal(packageHistory[0].sessionsTotal, 4);

    const archived = await service.setClientActive(created.id, false);
    assert.equal(archived.isActive, false);
    assert.ok(archived.archivedAt);
    assert.deepEqual(archived.sessionPreferences, [
      { day: "Tuesday", startTime: "09:00", status: "rejected" }
    ]);

    const archivedResult = await service.listClients({
      search: updatedEmail,
      status: "archived",
      page: 1,
      pageSize: 10
    });
    assert.equal(archivedResult.items[0].id, created.id);

    await assert.rejects(
      service.updatePreferences(created.id, {
        preferredDays: ["Monday"],
        preferredSchedule: { Monday: ["08:00"] }
      }),
      (error) => error.code === "CONFLICT"
    );

    const restored = await service.setClientActive(created.id, true);
    assert.equal(restored.isActive, true);
    assert.equal(restored.archivedAt, null);
    const resubmitted = await service.updatePreferences(created.id, {
      preferredDays: ["Tuesday"],
      preferredSchedule: { Tuesday: ["09:00"] }
    });
    assert.deepEqual(resubmitted.sessionPreferences, [
      { day: "Tuesday", startTime: "09:00", status: "pending" }
    ]);

    const concurrentResults = await Promise.allSettled([
      sessionsService.createManual({
        clientId: created.id,
        sessionDate: day(14),
        startTime: "14:00"
      }),
      service.setClientActive(created.id, false)
    ]);
    assert.equal(concurrentResults[1].status, "fulfilled");
    const futureAttendance = await testPool.query(
      `SELECT attendance.status
       FROM session_attendance attendance
       JOIN sessions session ON session.id = attendance.session_id
       WHERE attendance.client_id = $1
         AND session.session_date = $2`,
      [created.id, day(14)]
    );
    assert.ok(futureAttendance.rows.every((row) => row.status === "cancelled"));
  } finally {
    await testPool.query("DELETE FROM clients WHERE email IN ($1, $2)", [email, updatedEmail]);
  }
});

test("rolls back contact changes when an atomic preference update fails", async () => {
  const stamp = Date.now();
  const email = `atomic-${stamp}@example.com`;

  try {
    const created = await service.createClient({
      name: "Atomic Client",
      phone: "+27 82 999 0003",
      email,
      program: "Weight Loss",
      sessionType: "One-on-One",
      packageSize: 4,
      purchaseDate: PURCHASE_DATE,
      paid: false
    });
    await testPool.query("DELETE FROM packages WHERE client_id = $1", [created.id]);

    await assert.rejects(
      service.updateClient(created.id, {
        name: "Should Roll Back",
        phone: "+27 82 999 0004",
        email,
        preferredDays: ["Tuesday"],
        preferredSchedule: { Tuesday: ["09:00"] }
      }),
      (error) => error.code === "VALIDATION_ERROR"
    );

    const stored = await testPool.query(
      "SELECT name, phone FROM clients WHERE id = $1",
      [created.id]
    );
    assert.deepEqual(stored.rows[0], {
      name: "Atomic Client",
      phone: "+27 82 999 0003"
    });
  } finally {
    await testPool.query("DELETE FROM clients WHERE email = $1", [email]);
  }
});

test("goals live with their client: ordering, the cap, and the cascade", async () => {
  const email = `goals-${Date.now()}@example.com`;
  const created = await service.createClient({
    name: "Goal Client",
    phone: "+27 82 777 0000",
    email,
    program: "Weight Loss",
    sessionType: "One-on-One",
    packageSize: 4,
    purchaseDate: PURCHASE_DATE
  });

  try {
    await service.addClientGoal(created.id, {
      goal: "Train three times a week",
      targetDate: daysFromToday(30)
    });
    const twoGoals = await service.addClientGoal(created.id, { goal: "Lose 8kg" });

    // Newest first while both are being worked on.
    assert.deepEqual(
      twoGoals.map((item) => item.goal),
      ["Lose 8kg", "Train three times a week"]
    );

    // An achieved goal drops below the ones still being worked on.
    const first = twoGoals.at(-1);
    const afterAchieving = await service.updateClientGoal(created.id, first.id, {
      achieved: true
    });
    assert.deepEqual(
      afterAchieving.map((item) => item.goal),
      ["Lose 8kg", "Train three times a week"]
    );
    assert.equal(afterAchieving.at(-1).achievedAt, daysFromToday(0));

    // Five at a time, and an achieved one does not count against the cap.
    for (const goal of ["Goal B", "Goal C", "Goal D", "Goal E"]) {
      await service.addClientGoal(created.id, { goal });
    }
    await assert.rejects(
      service.addClientGoal(created.id, { goal: "One too many" }),
      (error) => error.status === 409
    );
    // Reopening the achieved one would make six, so it is refused too.
    await assert.rejects(
      service.updateClientGoal(created.id, first.id, { achieved: false }),
      (error) => error.status === 409
    );

    // The profile reads goals with the client, in the same order.
    const reloaded = await service.getClient(created.id);
    assert.equal(reloaded.goals.length, 6);
    assert.equal(reloaded.goals.at(-1).goal, "Train three times a week");

    // Removing one frees a slot.
    const afterRemoval = await service.removeClientGoal(created.id, reloaded.goals[0].id);
    assert.equal(afterRemoval.length, 5);

    // The database rejects a goal of only whitespace whatever the caller does.
    await assert.rejects(
      testPool.query("INSERT INTO client_goals (client_id, goal) VALUES ($1, '   ')", [
        created.id
      ]),
      (error) => error.code === "23514"
    );

    // Archiving is not a delete: the goals survive it.
    await service.setClientActive(created.id, false);
    const archived = await service.getClient(created.id);
    assert.equal(archived.goals.length, 5);
    await service.setClientActive(created.id, true);
  } finally {
    await testPool.query("DELETE FROM clients WHERE id = $1", [created.id]);
  }

  // Deleting the client took the goals with it.
  const left = await testPool.query("SELECT COUNT(*)::int AS total FROM client_goals WHERE client_id = $1", [
    created.id
  ]);
  assert.equal(left.rows[0].total, 0);
});

test("a goal given at signup is saved with the client, and a bad one saves nothing", async () => {
  const email = `signup-goal-${Date.now()}@example.com`;
  const base = {
    phone: "+27 82 666 0000",
    program: "Weight Loss",
    sessionType: "One-on-One",
    packageSize: 4,
    purchaseDate: PURCHASE_DATE
  };
  let created = null;

  try {
    created = await service.createClient({
      ...base,
      name: "Signup Goal Client",
      email,
      goal: "  Get back to running  "
    });

    const withGoal = await service.getClient(created.id);
    assert.equal(withGoal.goals.length, 1);
    assert.equal(withGoal.goals[0].goal, "Get back to running", "the goal is trimmed");
    assert.equal(withGoal.goals[0].achievedAt, null);

    // No goal is not an error.
    const plainEmail = `signup-nogoal-${Date.now()}@example.com`;
    const plain = await service.createClient({
      ...base,
      name: "No Goal Client",
      email: plainEmail
    });
    try {
      assert.deepEqual((await service.getClient(plain.id)).goals, []);
    } finally {
      await testPool.query("DELETE FROM clients WHERE id = $1", [plain.id]);
    }

    // A goal of only spaces takes the whole creation down with it.
    const rejectedEmail = `signup-bad-${Date.now()}@example.com`;
    await assert.rejects(
      service.createClient({
        ...base,
        name: "Rejected Client",
        email: rejectedEmail,
        goal: "x".repeat(201)
      }),
      (error) => error.status === 400
    );
    const leftover = await testPool.query("SELECT id FROM clients WHERE email = $1", [
      rejectedEmail
    ]);
    assert.equal(leftover.rowCount, 0, "nothing was written");
  } finally {
    if (created) {
      await testPool.query("DELETE FROM clients WHERE id = $1", [created.id]);
    }
  }
});

test("two trainers cannot see or touch each other's clients", async () => {
  // Both plain trainers on purpose: an admin sees everything, so using one
  // here would make the test pass for the wrong reason.
  const alice = actorFor(
    await ensureTestTrainer(testPool, { email: "alice@days4fitness.test", role: "trainer" })
  );
  const bob = actorFor(
    await ensureTestTrainer(testPool, { email: "bob@days4fitness.test", role: "trainer" })
  );
  const raw = createClientsService(createClientsRepository(testPool));
  const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const newClient = (name, phone, suffix) => ({
    name,
    phone,
    email: `${suffix}-${stamp}@example.com`,
    program: "Weight Loss",
    sessionType: "One-on-One",
    packageSize: 4,
    purchaseDate: PURCHASE_DATE,
    paid: false
  });

  const hers = await raw.createClient(newClient("Alice Client", "+27 82 900 0001", "alice"), alice);
  let his;

  try {
    // Alice sees her own client; Bob does not see it at all.
    const aliceList = await raw.listClients({ status: "all", pageSize: 50 }, alice);
    const bobList = await raw.listClients({ status: "all", pageSize: 50 }, bob);
    assert.ok(aliceList.items.some((item) => item.id === hers.id));
    assert.ok(
      !bobList.items.some((item) => item.id === hers.id),
      "Bob must not see Alice's client in his list"
    );

    // Guessing the id must read as missing rather than forbidden: a 403 would
    // confirm the client exists, which is itself a leak.
    await assert.rejects(() => raw.getClient(hers.id, bob), { status: 404 });

    // Every other way in has to refuse too. A list that filters correctly
    // while a detail or write route does not is the usual shape of this bug.
    // A complete payload on purpose: updateClient validates required fields
    // before it looks the client up, so an incomplete one would be refused
    // with a 400 and prove nothing about ownership. The 400 is identical
    // whether or not the client exists, so it leaks nothing either way.
    await assert.rejects(
      () => raw.updateClient(hers.id, { name: "Hijacked", phone: "+27 82 900 0009" }, bob),
      { status: 404 }
    );
    await assert.rejects(() => raw.setClientActive(hers.id, false, bob), { status: 404 });
    await assert.rejects(
      () => raw.updatePreferences(hers.id, { preferredDays: [] }, bob),
      { status: 404 }
    );
    await assert.rejects(() => raw.addClientGoal(hers.id, { goal: "Steal this" }, bob), {
      status: 404
    });
    await assert.rejects(() => raw.getPackageHistory(hers.id, bob), { status: 404 });
    await assert.rejects(() => raw.getSessionHistory(hers.id, bob), { status: 404 });

    // None of those attempts changed anything.
    const stillHers = await raw.getClient(hers.id, alice);
    assert.equal(stillHers.name, "Alice Client");
    assert.equal(stillHers.isActive, true);

    // A client Bob creates belongs to Bob, and Alice cannot see that one.
    his = await raw.createClient(newClient("Bob Client", "+27 82 900 0002", "bob"), bob);
    const aliceAgain = await raw.listClients({ status: "all", pageSize: 50 }, alice);
    assert.ok(!aliceAgain.items.some((item) => item.id === his.id));

    // The admin this suite runs as sees both, which is the point of the role.
    const adminList = await service.listClients({ status: "all", pageSize: 50 });
    assert.ok(adminList.items.some((item) => item.id === hers.id));
    assert.ok(adminList.items.some((item) => item.id === his.id));
  } finally {
    const ids = [hers?.id, his?.id].filter(Boolean);
    if (ids.length > 0) {
      await testPool.query("DELETE FROM clients WHERE id = ANY($1::bigint[])", [ids]);
    }
  }
});
