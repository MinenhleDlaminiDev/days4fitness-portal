// AUTH-09. Before this, bookingRequests.service.js took no acting trainer at
// all and no query filtered on ownership, so the whole surface was open: any
// trainer could list every other trainer's pending requests and approve one.
//
// Approving is not a read. It writes an approved_recurring_bookings row and
// allocates real sessions against the client's package, so an unscoped id was
// a write on somebody else's data. That is what these tests pin down: not
// only that Bob's request is absent from Alice's list, but that Alice acting
// on its id changes nothing at all.

import assert from "node:assert/strict";
import { after, test } from "node:test";
import pg from "pg";
import { env } from "../src/config/env.js";
import { createBookingRequestsRepository } from "../src/repositories/bookingRequests.repository.js";
import { createClientsRepository } from "../src/repositories/clients.repository.js";
import { createBookingRequestsService } from "../src/services/bookingRequests.service.js";
import { createClientsService } from "../src/services/clients.service.js";
import {
  actorFor,
  bindActor,
  bindBookingRequestsActor,
  ensureTestTrainer,
  withSettings
} from "./helpers/trainer.js";

const { Pool } = pg;

if (!env.testDatabaseUrl || !new URL(env.testDatabaseUrl).pathname.toLowerCase().includes("test")) {
  throw new Error("Booking request scoping tests require a safe TEST_DATABASE_URL");
}

const testPool = new Pool({ connectionString: env.testDatabaseUrl });

const alice = await ensureTestTrainer(testPool, {
  email: "alice-requests@days4fitness.test",
  role: "trainer"
});
const bob = await ensureTestTrainer(testPool, {
  email: "bob-requests@days4fitness.test",
  role: "trainer"
});
const businessAdmin = await ensureTestTrainer(testPool);

/** One pair of services per trainer, each acting as its own owner. */
function servicesFor(trainer) {
  return {
    clients: bindActor(
      createClientsService(createClientsRepository(testPool), withSettings(testPool)),
      actorFor(trainer)
    ),
    requests: bindBookingRequestsActor(
      createBookingRequestsService(createBookingRequestsRepository(testPool)),
      actorFor(trainer)
    )
  };
}

const asAlice = servicesFor(alice);
const asBob = servicesFor(bob);
const asAdmin = servicesFor(businessAdmin);

// These trainers outlive a run, so their fixtures are cleared either side.
async function clearFixtures() {
  for (const trainer of [alice, bob]) {
    await testPool.query("DELETE FROM clients WHERE trainer_user_id = $1", [trainer.id]);
    await testPool.query("DELETE FROM sessions WHERE trainer_user_id = $1", [trainer.id]);
  }
}

after(async () => {
  await clearFixtures();
  await testPool.end();
});

let nextSuffix = 0;

/** A client with one preferred slot, which raises one pending request. */
async function seedClientWithRequest(services, label, { day, startTime }) {
  nextSuffix += 1;
  return services.clients.createClient({
    name: `AUTH09 ${label}`,
    phone: "+27 82 555 0800",
    email: `auth09-${nextSuffix}-${Date.now()}@example.com`,
    program: "Weight Loss",
    sessionType: "One-on-One",
    packageSize: 4,
    purchaseDate: new Date().toISOString().slice(0, 10),
    paid: false,
    preferredDays: [day],
    preferredSchedule: { [day]: [startTime] }
  });
}

async function statusOf(requestId) {
  const result = await testPool.query(
    "SELECT status FROM recurring_booking_requests WHERE id = $1",
    [requestId]
  );
  return result.rows[0]?.status;
}

async function bookingAndSessionCount(requestId) {
  const bookings = await testPool.query(
    "SELECT COUNT(*)::int AS count FROM approved_recurring_bookings WHERE request_id = $1",
    [requestId]
  );
  const sessions = await testPool.query(
    `SELECT COUNT(*)::int AS count
     FROM session_attendance attendance
     JOIN approved_recurring_bookings booking
       ON booking.id = attendance.recurring_booking_id
     WHERE booking.request_id = $1`,
    [requestId]
  );
  return { bookings: bookings.rows[0].count, sessions: sessions.rows[0].count };
}

test("a trainer lists only the requests raised by their own clients", async () => {
  await clearFixtures();

  // Different days on purpose, so a leak shows up as the wrong day rather
  // than as two rows that could be either trainer's.
  const aliceClient = await seedClientWithRequest(asAlice, "Alice Client", {
    day: "Monday",
    startTime: "08:00"
  });
  const bobClient = await seedClientWithRequest(asBob, "Bob Client", {
    day: "Thursday",
    startTime: "15:00"
  });

  const alicePending = await asAlice.requests.listPending();
  const bobPending = await asBob.requests.listPending();

  assert.deepEqual(
    alicePending.filter((request) => request.clientId === bobClient.id),
    [],
    "Bob's request is not in Alice's list"
  );
  assert.deepEqual(
    bobPending.filter((request) => request.clientId === aliceClient.id),
    [],
    "Alice's request is not in Bob's list"
  );

  const aliceOwn = alicePending.filter((request) => request.clientId === aliceClient.id);
  const bobOwn = bobPending.filter((request) => request.clientId === bobClient.id);
  assert.equal(aliceOwn.length, 1);
  assert.equal(aliceOwn[0].day, "Monday");
  assert.equal(bobOwn.length, 1);
  assert.equal(bobOwn[0].day, "Thursday");

  // Alice's whole list is hers: not just missing Bob's, but containing
  // nothing that belongs to anyone else either.
  const aliceClientIds = new Set(alicePending.map((request) => request.clientId));
  const ownedByAlice = await testPool.query(
    `SELECT COUNT(*)::int AS count
     FROM clients
     WHERE id = ANY($1::bigint[])
       AND trainer_user_id <> $2`,
    [[...aliceClientIds], alice.id]
  );
  assert.equal(ownedByAlice.rows[0].count, 0);

  // The admin still sees the business.
  const adminPending = await asAdmin.requests.listPending();
  const adminClientIds = adminPending.map((request) => request.clientId);
  assert.ok(adminClientIds.includes(aliceClient.id));
  assert.ok(adminClientIds.includes(bobClient.id));
});

test("approving another trainer's request is a 404 and writes nothing", async () => {
  await clearFixtures();

  const bobClient = await seedClientWithRequest(asBob, "Bob Approve", {
    day: "Tuesday",
    startTime: "09:00"
  });
  const bobRequest = (await asBob.requests.listPending()).find(
    (request) => request.clientId === bobClient.id
  );
  assert.ok(bobRequest, "Bob's own request exists to be attacked");

  await assert.rejects(
    asAlice.requests.approve(bobRequest.id),
    (error) => error.status === 404 && error.code === "NOT_FOUND",
    "Not Found, not Forbidden: a 403 would confirm the id exists"
  );

  assert.equal(await statusOf(bobRequest.id), "pending", "the request is untouched");
  assert.deepEqual(
    await bookingAndSessionCount(bobRequest.id),
    { bookings: 0, sessions: 0 },
    "no recurring booking and no sessions were created"
  );

  // Bob can still approve it himself, which proves the refusal was about
  // ownership and not about the request being unapprovable.
  const approved = await asBob.requests.approve(bobRequest.id);
  assert.equal(approved.request.status, "approved");
  assert.ok(approved.generatedSessions > 0, "Bob's own approval does allocate sessions");
});

test("rejecting another trainer's request is a 404 and leaves preferences alone", async () => {
  await clearFixtures();

  const bobClient = await seedClientWithRequest(asBob, "Bob Reject", {
    day: "Wednesday",
    startTime: "10:00"
  });
  const bobRequest = (await asBob.requests.listPending()).find(
    (request) => request.clientId === bobClient.id
  );
  assert.ok(bobRequest);

  const before = await testPool.query(
    "SELECT preferred_days, preferred_schedule FROM clients WHERE id = $1",
    [bobClient.id]
  );

  await assert.rejects(
    asAlice.requests.reject(bobRequest.id),
    (error) => error.status === 404 && error.code === "NOT_FOUND"
  );

  assert.equal(await statusOf(bobRequest.id), "pending");
  const afterRefusal = await testPool.query(
    "SELECT preferred_days, preferred_schedule FROM clients WHERE id = $1",
    [bobClient.id]
  );
  assert.deepEqual(
    afterRefusal.rows[0],
    before.rows[0],
    "a rejection strips the slot from the client's preferences, so this must not have run"
  );

  // Bob's own rejection does go through, and does strip the slot.
  const rejected = await asBob.requests.reject(bobRequest.id);
  assert.equal(rejected.status, "rejected");
  const afterOwnReject = await testPool.query(
    "SELECT preferred_schedule FROM clients WHERE id = $1",
    [bobClient.id]
  );
  assert.deepEqual(afterOwnReject.rows[0].preferred_schedule, {});
});

test("an unknown id is the same 404 as another trainer's id", async () => {
  // The two must be indistinguishable, or the error itself tells a caller
  // which ids exist.
  await assert.rejects(
    asAlice.requests.approve(2147483000),
    (error) => error.status === 404 && error.code === "NOT_FOUND"
  );
  await assert.rejects(
    asAlice.requests.reject(2147483000),
    (error) => error.status === 404 && error.code === "NOT_FOUND"
  );
});

test("a missing actor is a 401 rather than being read as unrestricted", async () => {
  const unbound = createBookingRequestsService(createBookingRequestsRepository(testPool));

  await assert.rejects(unbound.listPending(), (error) => error.status === 401);
  await assert.rejects(unbound.approve(1), (error) => error.status === 401);
  await assert.rejects(unbound.reject(1), (error) => error.status === 401);
});
