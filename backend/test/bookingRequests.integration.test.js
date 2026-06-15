import assert from "node:assert/strict";
import { after, afterEach, test } from "node:test";
import pg from "pg";
import { env } from "../src/config/env.js";
import { createBookingRequestsRepository } from "../src/repositories/bookingRequests.repository.js";
import { createClientsRepository } from "../src/repositories/clients.repository.js";
import { createSessionsRepository } from "../src/repositories/sessions.repository.js";
import { createBookingRequestsService } from "../src/services/bookingRequests.service.js";
import { createClientsService } from "../src/services/clients.service.js";
import { createSessionsService } from "../src/services/sessions.service.js";

const { Pool } = pg;

if (!env.testDatabaseUrl || !new URL(env.testDatabaseUrl).pathname.toLowerCase().includes("test")) {
  throw new Error("Integration tests require a safe TEST_DATABASE_URL");
}

const testPool = new Pool({ connectionString: env.testDatabaseUrl });
const clientsService = createClientsService(createClientsRepository(testPool));
const requestsService = createBookingRequestsService(createBookingRequestsRepository(testPool));
const sessionsService = createSessionsService(createSessionsRepository(testPool));
const createdEmails = [];
const DAY_NAMES = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

after(async () => {
  await testPool.end();
});

afterEach(async () => {
  if (createdEmails.length > 0) {
    await testPool.query("DELETE FROM clients WHERE email = ANY($1::text[])", [createdEmails]);
    createdEmails.length = 0;
  }
  await testPool.query(
    `DELETE FROM sessions session
     WHERE NOT EXISTS (
       SELECT 1 FROM session_attendance attendance WHERE attendance.session_id = session.id
     )`
  );
});

async function createClient({
  suffix,
  sessionType = "One-on-One",
  program = "Weight Loss",
  packageSize = 4,
  purchaseDate = new Date().toISOString().slice(0, 10),
  preferredDays,
  preferredSchedule
}) {
  const email = `phase3-${suffix}-${Date.now()}@example.com`;
  createdEmails.push(email);
  return clientsService.createClient({
    name: `Phase 3 ${suffix}`,
    phone: "+27 82 777 0000",
    email,
    program,
    sessionType,
    packageSize,
    purchaseDate,
    paid: false,
    preferredDays,
    preferredSchedule
  });
}

async function pendingForClient(clientId) {
  return (await requestsService.listPending()).filter((request) => request.clientId === clientId);
}

async function createManualRequest({ suffix, dayOfWeek, startTime }) {
  const email = `phase3-${suffix}-${Date.now()}@example.com`;
  createdEmails.push(email);
  const program = await testPool.query(
    "SELECT id FROM programs WHERE name = 'Weight Loss' AND type = 'one_on_one'"
  );
  const client = await testPool.query(
    `INSERT INTO clients (name, phone, email)
     VALUES ($1, '+27 82 777 0500', $2)
     RETURNING id`,
    [`Phase 3 ${suffix}`, email]
  );
  const packageResult = await testPool.query(
    `INSERT INTO packages (
       client_id,
       program_id,
       sessions_total,
       price,
       purchase_date,
       expiry_date
     )
     VALUES ($1, $2, 1, 380, CURRENT_DATE, CURRENT_DATE + 60)
     RETURNING id`,
    [client.rows[0].id, program.rows[0].id]
  );
  const request = await testPool.query(
    `INSERT INTO recurring_booking_requests (
       client_id,
       package_id,
       day_of_week,
       start_time,
       source
     )
     VALUES ($1, $2, $3, $4::time, 'manual')
     RETURNING id`,
    [client.rows[0].id, packageResult.rows[0].id, dayOfWeek, startTime]
  );
  return request.rows[0].id;
}

async function nextBookableDate(dayOfWeek, startTime) {
  const result = await testPool.query(
    `WITH business_now AS (
       SELECT CURRENT_TIMESTAMP AT TIME ZONE $3 AS value
     ),
     candidate AS (
       SELECT
         value::date
         + (($1::int - EXTRACT(ISODOW FROM value)::int + 7) % 7) AS session_date,
         value
       FROM business_now
     )
     SELECT (
       CASE
         WHEN session_date = value::date AND $2::time <= value::time
           THEN session_date + 7
         ELSE session_date
       END
     )::text AS session_date
     FROM candidate`,
    [dayOfWeek, startTime, env.businessTimezone]
  );
  return result.rows[0].session_date;
}

test("partially approves weekly preferences and allocates only package credits", async () => {
  const client = await createClient({
    suffix: "partial",
    preferredDays: ["Monday", "Wednesday", "Friday"],
    preferredSchedule: {
      Monday: ["08:00"],
      Wednesday: ["08:00"],
      Friday: ["08:00"]
    }
  });
  const requests = await pendingForClient(client.id);

  assert.equal(requests.length, 3);
  await requestsService.approve(requests.find((request) => request.day === "Monday").id);
  await requestsService.approve(requests.find((request) => request.day === "Wednesday").id);
  await requestsService.reject(requests.find((request) => request.day === "Friday").id);
  const clientAfterReview = await clientsService.getClient(client.id);

  const bookings = await testPool.query(
    `SELECT day_of_week
     FROM approved_recurring_bookings
     WHERE client_id = $1
     ORDER BY day_of_week`,
    [client.id]
  );
  const attendance = await testPool.query(
    `SELECT
       attendance.recurring_booking_id,
       session.session_date::text
     FROM session_attendance attendance
     JOIN sessions session ON session.id = attendance.session_id
     WHERE attendance.client_id = $1
       AND attendance.status = 'scheduled'
     ORDER BY attendance.recurring_booking_id, session.session_date`,
    [client.id]
  );
  const packageRow = await testPool.query(
    "SELECT sessions_total, expiry_date::text FROM packages WHERE client_id = $1",
    [client.id]
  );

  assert.deepEqual(bookings.rows.map((row) => row.day_of_week), [1, 3]);
  assert.equal(attendance.rows.length, packageRow.rows[0].sessions_total);
  assert.equal(new Set(attendance.rows.map((row) => row.recurring_booking_id)).size, 2);
  assert.ok(
    attendance.rows.every((row) => row.session_date <= packageRow.rows[0].expiry_date)
  );
  for (const recurringBookingId of new Set(
    attendance.rows.map((row) => row.recurring_booking_id)
  )) {
    const dates = attendance.rows
      .filter((row) => row.recurring_booking_id === recurringBookingId)
      .map((row) => new Date(`${row.session_date}T00:00:00Z`));
    for (let index = 1; index < dates.length; index += 1) {
      assert.equal((dates[index] - dates[index - 1]) / 86400000, 7);
    }
  }
  assert.equal((await pendingForClient(client.id)).length, 0);
  assert.deepEqual(clientAfterReview.sessionPreferences, [
    { day: "Monday", startTime: "08:00", status: "approved" },
    { day: "Wednesday", startTime: "08:00", status: "approved" },
    { day: "Friday", startTime: "08:00", status: "rejected" }
  ]);
});

test("rejects a conflicting one-on-one weekly slot", async () => {
  const first = await createClient({
    suffix: "conflict-one",
    packageSize: 1,
    preferredDays: ["Tuesday"],
    preferredSchedule: { Tuesday: ["09:00"] }
  });
  const second = await createClient({
    suffix: "conflict-two",
    packageSize: 1,
    preferredDays: ["Tuesday"],
    preferredSchedule: { Tuesday: ["09:00"] }
  });

  await requestsService.approve((await pendingForClient(first.id))[0].id);
  await assert.rejects(
    requestsService.approve((await pendingForClient(second.id))[0].id),
    (error) => error.status === 409 && error.code === "CONFLICT"
  );
});

test("rejects overlapping one-hour recurring bookings with different start times", async () => {
  const firstRequestId = await createManualRequest({
    suffix: "overlap-first",
    dayOfWeek: 2,
    startTime: "08:00"
  });
  const secondRequestId = await createManualRequest({
    suffix: "overlap-second",
    dayOfWeek: 2,
    startTime: "08:30"
  });

  await requestsService.approve(firstRequestId);
  await assert.rejects(
    requestsService.approve(secondRequestId),
    (error) => error.status === 409 && error.code === "CONFLICT"
  );
});

test("rejects recurrence generation that overlaps an existing date-specific session", async () => {
  const requestId = await createManualRequest({
    suffix: "existing-session-overlap",
    dayOfWeek: 5,
    startTime: "08:30"
  });
  const requestDetails = await testPool.query(
    `SELECT package.program_id
     FROM recurring_booking_requests request
     JOIN packages package ON package.id = request.package_id
     WHERE request.id = $1`,
    [requestId]
  );
  const existingSession = await testPool.query(
    `INSERT INTO sessions (
       program_id,
       session_type,
       session_date,
       start_time,
       capacity,
       status
     )
     VALUES (
       $1,
       'one_on_one',
       CURRENT_DATE
         + CASE
             WHEN ((5 - EXTRACT(ISODOW FROM CURRENT_DATE)::int + 7) % 7) = 0
               THEN 7
             ELSE ((5 - EXTRACT(ISODOW FROM CURRENT_DATE)::int + 7) % 7)
           END,
       '08:00',
       1,
       'scheduled'
     )
     RETURNING id`,
    [requestDetails.rows[0].program_id]
  );

  await assert.rejects(
    requestsService.approve(requestId),
    (error) => error.status === 409 && error.code === "CONFLICT"
  );

  const state = await testPool.query(
    `SELECT
       request.status,
       COUNT(booking.id)::int AS booking_count
     FROM recurring_booking_requests request
     LEFT JOIN approved_recurring_bookings booking ON booking.request_id = request.id
     WHERE request.id = $1
     GROUP BY request.status`,
    [requestId]
  );
  const preservedSession = await testPool.query(
    "SELECT id FROM sessions WHERE id = $1",
    [existingSession.rows[0].id]
  );

  assert.equal(state.rows[0].status, "pending");
  assert.equal(state.rows[0].booking_count, 0);
  assert.equal(preservedSession.rows.length, 1);
});

test("allows adjacent one-hour recurring bookings", async () => {
  const firstRequestId = await createManualRequest({
    suffix: "adjacent-first",
    dayOfWeek: 4,
    startTime: "08:00"
  });
  const secondRequestId = await createManualRequest({
    suffix: "adjacent-second",
    dayOfWeek: 4,
    startTime: "09:00"
  });

  const first = await requestsService.approve(firstRequestId);
  const second = await requestsService.approve(secondRequestId);

  assert.equal(first.generatedSessions, 1);
  assert.equal(second.generatedSessions, 1);
});

test("serializes concurrent approvals for overlapping one-hour intervals", async () => {
  const firstRequestId = await createManualRequest({
    suffix: "concurrent-overlap-first",
    dayOfWeek: 3,
    startTime: "06:00"
  });
  const secondRequestId = await createManualRequest({
    suffix: "concurrent-overlap-second",
    dayOfWeek: 3,
    startTime: "06:30"
  });

  const results = await Promise.allSettled([
    requestsService.approve(firstRequestId),
    requestsService.approve(secondRequestId)
  ]);

  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  assert.equal(
    results.find((result) => result.status === "rejected").reason.status,
    409
  );
});

test("serializes a manual booking against a recurring approval for the same slot", async () => {
  const recurringClient = await createClient({
    suffix: "manual-recurring-lock",
    packageSize: 1,
    preferredDays: ["Wednesday"],
    preferredSchedule: { Wednesday: ["08:00"] }
  });
  const manualClient = await createClient({
    suffix: "manual-recurring-manual",
    packageSize: 1,
    preferredDays: [],
    preferredSchedule: {}
  });
  const request = (await pendingForClient(recurringClient.id))[0];
  const sessionDate = await nextBookableDate(3, "08:00");

  const results = await Promise.allSettled([
    requestsService.approve(request.id),
    sessionsService.createManual({
      clientId: manualClient.id,
      sessionDate,
      startTime: "08:00"
    })
  ]);
  const attendanceResult = await testPool.query(
    `SELECT COUNT(*)::int AS count
     FROM session_attendance attendance
     JOIN sessions session ON session.id = attendance.session_id
     WHERE session.session_date = $1::date
       AND session.start_time = '08:00'
       AND attendance.client_id = ANY($2::bigint[])`,
    [sessionDate, [recurringClient.id, manualClient.id]]
  );

  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  assert.equal(attendanceResult.rows[0].count, 1);
});

test("does not let expired recurring bookings block a weekly slot", async () => {
  const expiredEmail = `phase3-expired-${Date.now()}@example.com`;
  createdEmails.push(expiredEmail);
  const program = await testPool.query(
    "SELECT id FROM programs WHERE name = 'Weight Loss' AND type = 'one_on_one'"
  );
  const expiredClient = await testPool.query(
    `INSERT INTO clients (name, phone, email)
     VALUES ('Expired Booking Client', '+27 82 777 1000', $1)
     RETURNING id`,
    [expiredEmail]
  );
  const expiredPackage = await testPool.query(
    `INSERT INTO packages (
       client_id,
       program_id,
       sessions_total,
       price,
       purchase_date,
       expiry_date
     )
     VALUES ($1, $2, 1, 380, CURRENT_DATE - 90, CURRENT_DATE - 30)
     RETURNING id`,
    [expiredClient.rows[0].id, program.rows[0].id]
  );
  const expiredRequest = await testPool.query(
    `INSERT INTO recurring_booking_requests (
       client_id,
       package_id,
       day_of_week,
       start_time,
       status,
       reviewed_at
     )
     VALUES ($1, $2, 2, '12:00', 'approved', NOW())
     RETURNING id`,
    [expiredClient.rows[0].id, expiredPackage.rows[0].id]
  );
  await testPool.query(
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
     VALUES ($1, $2, $3, $4, 'one_on_one', 2, '12:00', CURRENT_DATE - 90, CURRENT_DATE - 30)`,
    [
      expiredRequest.rows[0].id,
      expiredClient.rows[0].id,
      expiredPackage.rows[0].id,
      program.rows[0].id
    ]
  );

  const currentClient = await createClient({
    suffix: "after-expiry",
    packageSize: 1,
    preferredDays: ["Tuesday"],
    preferredSchedule: { Tuesday: ["12:00"] }
  });

  const result = await requestsService.approve((await pendingForClient(currentClient.id))[0].id);
  assert.equal(result.generatedSessions, 1);
});

test("allows the same weekly slot when recurring date ranges do not overlap", async () => {
  const futureEmail = `phase3-future-${Date.now()}@example.com`;
  createdEmails.push(futureEmail);
  const program = await testPool.query(
    "SELECT id FROM programs WHERE name = 'Weight Loss' AND type = 'one_on_one'"
  );
  const futureClient = await testPool.query(
    `INSERT INTO clients (name, phone, email)
     VALUES ('Future Booking Client', '+27 82 777 1500', $1)
     RETURNING id`,
    [futureEmail]
  );
  const futurePackage = await testPool.query(
    `INSERT INTO packages (
       client_id,
       program_id,
       sessions_total,
       price,
       purchase_date,
       expiry_date
     )
     VALUES ($1, $2, 1, 380, CURRENT_DATE + 120, CURRENT_DATE + 180)
     RETURNING id`,
    [futureClient.rows[0].id, program.rows[0].id]
  );
  const futureRequest = await testPool.query(
    `INSERT INTO recurring_booking_requests (
       client_id,
       package_id,
       day_of_week,
       start_time,
       status,
       reviewed_at
     )
     VALUES ($1, $2, 1, '17:00', 'approved', NOW())
     RETURNING id`,
    [futureClient.rows[0].id, futurePackage.rows[0].id]
  );
  await testPool.query(
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
     VALUES (
       $1,
       $2,
       $3,
       $4,
       'one_on_one',
       1,
       '17:00',
       CURRENT_DATE + 120,
       CURRENT_DATE + 180
     )`,
    [
      futureRequest.rows[0].id,
      futureClient.rows[0].id,
      futurePackage.rows[0].id,
      program.rows[0].id
    ]
  );

  const currentClient = await createClient({
    suffix: "before-future",
    packageSize: 1,
    preferredDays: ["Monday"],
    preferredSchedule: { Monday: ["17:00"] }
  });

  const result = await requestsService.approve((await pendingForClient(currentClient.id))[0].id);
  assert.equal(result.generatedSessions, 1);
});

test("allows a later client after an earlier package has allocated all credits", async () => {
  const first = await createClient({
    suffix: "exhausted-slot-first",
    packageSize: 1,
    preferredDays: ["Monday"],
    preferredSchedule: { Monday: ["19:00"] }
  });
  await requestsService.approve((await pendingForClient(first.id))[0].id);

  const firstSession = await testPool.query(
    `SELECT session.session_date::text
     FROM sessions session
     JOIN session_attendance attendance ON attendance.session_id = session.id
     WHERE attendance.client_id = $1`,
    [first.id]
  );
  const laterPurchaseDate = new Date(`${firstSession.rows[0].session_date}T00:00:00Z`);
  laterPurchaseDate.setUTCDate(laterPurchaseDate.getUTCDate() + 7);

  const second = await createClient({
    suffix: "exhausted-slot-second",
    packageSize: 1,
    purchaseDate: laterPurchaseDate.toISOString().slice(0, 10),
    preferredDays: ["Monday"],
    preferredSchedule: { Monday: ["19:00"] }
  });

  const result = await requestsService.approve((await pendingForClient(second.id))[0].id);
  assert.equal(result.generatedSessions, 1);
});

test("rejects approval when the package has already expired", async () => {
  const email = `phase3-expired-request-${Date.now()}@example.com`;
  createdEmails.push(email);
  const program = await testPool.query(
    "SELECT id FROM programs WHERE name = 'Weight Loss' AND type = 'one_on_one'"
  );
  const client = await testPool.query(
    `INSERT INTO clients (
       name,
       phone,
       email,
       preferred_days,
       preferred_schedule
     )
     VALUES (
       'Expired Request Client',
       '+27 82 777 2000',
       $1,
       ARRAY['Wednesday'],
       '{"Wednesday":["13:00"]}'::jsonb
     )
     RETURNING id`,
    [email]
  );
  const packageResult = await testPool.query(
    `INSERT INTO packages (
       client_id,
       program_id,
       sessions_total,
       price,
       purchase_date,
       expiry_date
     )
     VALUES ($1, $2, 1, 380, CURRENT_DATE - 90, CURRENT_DATE - 30)
     RETURNING id`,
    [client.rows[0].id, program.rows[0].id]
  );
  const request = await testPool.query(
    `INSERT INTO recurring_booking_requests (
       client_id,
       package_id,
       day_of_week,
       start_time,
       source
     )
     VALUES ($1, $2, 3, '13:00', 'client_preference')
     RETURNING id`,
    [client.rows[0].id, packageResult.rows[0].id]
  );

  await assert.rejects(
    requestsService.approve(request.rows[0].id),
    (error) => error.status === 409 && error.code === "CONFLICT"
  );
});

test("starts next week when today's requested time has already passed", async () => {
  const timezoneResult = await testPool.query(
    `SELECT name
     FROM pg_timezone_names
     WHERE EXTRACT(ISODOW FROM NOW() AT TIME ZONE name) BETWEEN 1 AND 6
       AND (NOW() AT TIME ZONE name)::time > TIME '05:00'
     ORDER BY name
     LIMIT 1`
  );
  const timezone = timezoneResult.rows[0].name;
  const timeAwarePool = new Pool({
    connectionString: env.testDatabaseUrl,
    options: `-c timezone=${timezone}`
  });
  const timeAwareClients = createClientsService(createClientsRepository(timeAwarePool));
  const timeAwareRequests = createBookingRequestsService(
    createBookingRequestsRepository(timeAwarePool, { businessTimezone: timezone })
  );
  const localNow = await timeAwarePool.query(
    `SELECT
       CURRENT_DATE::text AS current_date,
       EXTRACT(ISODOW FROM CURRENT_DATE)::int AS day_of_week`
  );
  const email = `phase3-passed-today-${Date.now()}@example.com`;
  createdEmails.push(email);

  try {
    const client = await timeAwareClients.createClient({
      name: "Phase 3 Passed Today",
      phone: "+27 82 777 2500",
      email,
      program: "Weight Loss",
      sessionType: "One-on-One",
      packageSize: 1,
      purchaseDate: localNow.rows[0].current_date,
      paid: false,
      preferredDays: [DAY_NAMES[localNow.rows[0].day_of_week]],
      preferredSchedule: { [DAY_NAMES[localNow.rows[0].day_of_week]]: ["05:00"] }
    });
    const request = (await timeAwareRequests.listPending()).find(
      (item) => item.clientId === client.id
    );

    await timeAwareRequests.approve(request.id);

    const allocation = await timeAwarePool.query(
      `SELECT
         booking.starts_on::text,
         session.session_date::text
       FROM approved_recurring_bookings booking
       JOIN session_attendance attendance ON attendance.recurring_booking_id = booking.id
       JOIN sessions session ON session.id = attendance.session_id
       WHERE booking.client_id = $1`,
      [client.id]
    );

    assert.equal(
      (new Date(`${allocation.rows[0].starts_on}T00:00:00Z`) -
        new Date(`${localNow.rows[0].current_date}T00:00:00Z`)) /
        86400000,
      7
    );
    assert.equal(allocation.rows[0].session_date, allocation.rows[0].starts_on);
  } finally {
    await timeAwarePool.end();
  }
});

test("serializes simultaneous one-on-one approvals for the same weekly slot", async () => {
  const first = await createClient({
    suffix: "concurrent-one",
    packageSize: 1,
    preferredDays: ["Friday"],
    preferredSchedule: { Friday: ["14:00"] }
  });
  const second = await createClient({
    suffix: "concurrent-two",
    packageSize: 1,
    preferredDays: ["Friday"],
    preferredSchedule: { Friday: ["14:00"] }
  });
  const firstRequest = (await pendingForClient(first.id))[0];
  const secondRequest = (await pendingForClient(second.id))[0];

  const results = await Promise.allSettled([
    requestsService.approve(firstRequest.id),
    requestsService.approve(secondRequest.id)
  ]);

  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  assert.equal(
    results.find((result) => result.status === "rejected").reason.status,
    409
  );
});

test("rebalances simultaneous approvals for different slots on one package", async () => {
  const client = await createClient({
    suffix: "concurrent-package",
    packageSize: 4,
    preferredDays: ["Monday", "Wednesday"],
    preferredSchedule: { Monday: ["16:00"], Wednesday: ["16:00"] }
  });
  const requests = await pendingForClient(client.id);

  const results = await Promise.all(
    requests.map((request) => requestsService.approve(request.id))
  );
  const attendance = await testPool.query(
    `SELECT COUNT(*)::int AS count, COUNT(DISTINCT recurring_booking_id)::int AS booking_count
     FROM session_attendance
     WHERE client_id = $1
       AND status = 'scheduled'`,
    [client.id]
  );

  assert.equal(results.length, 2);
  assert.deepEqual(
    results.map((result) => result.generatedSessions).sort((left, right) => left - right),
    [2, 4]
  );
  assert.equal(attendance.rows[0].count, 4);
  assert.equal(attendance.rows[0].booking_count, 2);
});

test("serializes cross-day package rebalancing with a shared group slot", async () => {
  const multiSlotClient = await createClient({
    suffix: "group-cross-day-package",
    sessionType: "Group",
    program: "Small Groups",
    packageSize: 4,
    preferredDays: ["Monday", "Wednesday"],
    preferredSchedule: { Monday: ["18:00"], Wednesday: ["18:00"] }
  });
  const multiSlotRequests = await pendingForClient(multiSlotClient.id);
  await requestsService.approve(
    multiSlotRequests.find((request) => request.day === "Monday").id
  );

  const mondayClient = await createClient({
    suffix: "group-cross-day-monday",
    sessionType: "Group",
    program: "Small Groups",
    packageSize: 1,
    preferredDays: ["Monday"],
    preferredSchedule: { Monday: ["18:00"] }
  });
  const mondayRequest = (await pendingForClient(mondayClient.id))[0];

  const results = await Promise.allSettled([
    requestsService.approve(
      multiSlotRequests.find((request) => request.day === "Wednesday").id
    ),
    requestsService.approve(mondayRequest.id)
  ]);
  const mondayAttendance = await testPool.query(
    `SELECT COUNT(*)::int AS count
     FROM session_attendance attendance
     JOIN sessions session ON session.id = attendance.session_id
     WHERE attendance.client_id = ANY($1::bigint[])
       AND EXTRACT(ISODOW FROM session.session_date) = 1
       AND session.start_time = '18:00'
       AND attendance.status = 'scheduled'`,
    [[multiSlotClient.id, mondayClient.id]]
  );

  assert.equal(results.filter((result) => result.status === "fulfilled").length, 2);
  assert.equal(mondayAttendance.rows[0].count, 3);
});

test("preserves manual future sessions while rebalancing recurring allocations", async () => {
  const client = await createClient({
    suffix: "manual-preserved",
    packageSize: 4,
    preferredDays: ["Monday", "Wednesday"],
    preferredSchedule: { Monday: ["15:00"], Wednesday: ["15:00"] }
  });
  const requests = await pendingForClient(client.id);
  await requestsService.approve(requests.find((request) => request.day === "Monday").id);

  const packageResult = await testPool.query(
    `SELECT package.id, package.program_id
     FROM packages package
     WHERE package.client_id = $1`,
    [client.id]
  );
  const manualSession = await testPool.query(
    `INSERT INTO sessions (
       program_id,
       session_type,
       session_date,
       start_time,
       capacity,
       status
     )
     VALUES (
       $1,
       'one_on_one',
       CURRENT_DATE
         + ((4 - EXTRACT(ISODOW FROM CURRENT_DATE)::int + 7) % 7)
         + 7,
       '19:00',
       1,
       'scheduled'
     )
     RETURNING id`,
    [packageResult.rows[0].program_id]
  );
  await testPool.query(
    `INSERT INTO session_attendance (session_id, client_id, package_id)
     VALUES ($1, $2, $3)`,
    [manualSession.rows[0].id, client.id, packageResult.rows[0].id]
  );

  await requestsService.approve(requests.find((request) => request.day === "Wednesday").id);

  const manualAttendance = await testPool.query(
    `SELECT attendance.id
     FROM session_attendance attendance
     WHERE attendance.session_id = $1
       AND attendance.client_id = $2
       AND attendance.recurring_booking_id IS NULL`,
    [manualSession.rows[0].id, client.id]
  );
  const activeAttendance = await testPool.query(
    `SELECT COUNT(*)::int AS count
     FROM session_attendance
     WHERE package_id = $1
       AND status <> 'cancelled'`,
    [packageResult.rows[0].id]
  );

  assert.equal(manualAttendance.rows.length, 1);
  assert.equal(activeAttendance.rows[0].count, 4);
});

test("shares group sessions and enforces configured weekly capacity", async () => {
  const clients = [];
  for (let index = 0; index < 9; index += 1) {
    clients.push(
      await createClient({
        suffix: `group-${index}`,
        sessionType: "Group",
        program: "Small Groups",
        packageSize: 1,
        preferredDays: ["Thursday"],
        preferredSchedule: { Thursday: ["10:00"] }
      })
    );
  }

  for (const client of clients.slice(0, 8)) {
    await requestsService.approve((await pendingForClient(client.id))[0].id);
  }
  await assert.rejects(
    requestsService.approve((await pendingForClient(clients[8].id))[0].id),
    (error) => error.status === 409 && error.code === "CONFLICT"
  );

  const groupSession = await testPool.query(
    `SELECT session.id, COUNT(attendance.id)::int AS attendees
     FROM sessions session
     JOIN session_attendance attendance ON attendance.session_id = session.id
     WHERE session.session_type = 'group'
       AND session.start_time = '10:00'
       AND attendance.client_id = ANY($1::bigint[])
     GROUP BY session.id
     ORDER BY attendees DESC
     LIMIT 1`,
    [clients.map((client) => client.id)]
  );

  assert.equal(groupSession.rows[0].attendees, 8);
});

test("does not regenerate a cancelled recurring occurrence during package reallocation", async () => {
  const client = await createClient({
    suffix: "cancelled-occurrence",
    packageSize: 4,
    preferredDays: ["Monday", "Wednesday"],
    preferredSchedule: {
      Monday: ["08:00"],
      Wednesday: ["09:00"]
    }
  });
  const requests = await pendingForClient(client.id);
  const mondayRequest = requests.find((request) => request.day === "Monday");
  const wednesdayRequest = requests.find((request) => request.day === "Wednesday");

  await requestsService.approve(mondayRequest.id);
  const occurrenceResult = await testPool.query(
    `SELECT session.id, session.session_date::text, attendance.id AS attendance_id
     FROM session_attendance attendance
     JOIN sessions session ON session.id = attendance.session_id
     WHERE attendance.client_id = $1
       AND attendance.recurring_booking_id IS NOT NULL
     ORDER BY session.session_date
     LIMIT 1`,
    [client.id]
  );
  const occurrence = occurrenceResult.rows[0];
  await testPool.query("UPDATE sessions SET status = 'cancelled' WHERE id = $1", [
    occurrence.id
  ]);
  await testPool.query(
    `UPDATE session_attendance
     SET status = 'cancelled', credit_consumed = false
     WHERE id = $1`,
    [occurrence.attendance_id]
  );

  await requestsService.approve(wednesdayRequest.id);

  const matchingOccurrences = await testPool.query(
    `SELECT COUNT(*)::int AS count
     FROM session_attendance attendance
     JOIN sessions session ON session.id = attendance.session_id
     WHERE attendance.client_id = $1
       AND session.session_date = $2::date`,
    [client.id, occurrence.session_date]
  );
  assert.equal(matchingOccurrences.rows[0].count, 1);
});

test("removing an approved preference reallocates credits and requires reapproval", async () => {
  const client = await createClient({
    suffix: "update",
    packageSize: 4,
    preferredDays: ["Monday", "Wednesday"],
    preferredSchedule: { Monday: ["11:00"], Wednesday: ["11:00"] }
  });
  const requests = await pendingForClient(client.id);
  await requestsService.approve(requests.find((request) => request.day === "Monday").id);
  await requestsService.approve(requests.find((request) => request.day === "Wednesday").id);

  await clientsService.updatePreferences(client.id, {
    preferredDays: ["Wednesday", "Friday"],
    preferredSchedule: { Wednesday: ["11:00"], Friday: ["11:00"] }
  });

  const pending = await pendingForClient(client.id);
  const approved = await testPool.query(
    `SELECT day_of_week, status
     FROM approved_recurring_bookings
     WHERE client_id = $1
     ORDER BY id`,
    [client.id]
  );
  const mondayRequest = await testPool.query(
    `SELECT status
     FROM recurring_booking_requests
     WHERE client_id = $1
       AND day_of_week = 1
       AND start_time = '11:00'`,
    [client.id]
  );
  const scheduledMondayAttendance = await testPool.query(
    `SELECT COUNT(*)::int AS count
     FROM session_attendance attendance
     JOIN sessions session ON session.id = attendance.session_id
     WHERE attendance.client_id = $1
       AND attendance.status = 'scheduled'
       AND EXTRACT(ISODOW FROM session.session_date) = 1`,
    [client.id]
  );
  const scheduledWednesdayAttendance = await testPool.query(
    `SELECT COUNT(*)::int AS count
     FROM session_attendance attendance
     JOIN sessions session ON session.id = attendance.session_id
     JOIN approved_recurring_bookings booking
       ON booking.id = attendance.recurring_booking_id
     WHERE attendance.client_id = $1
       AND attendance.status = 'scheduled'
       AND booking.status = 'active'
       AND booking.day_of_week = 3`,
    [client.id]
  );

  assert.deepEqual(pending.map((request) => request.day), ["Friday"]);
  assert.deepEqual(approved.rows, [
    { day_of_week: 1, status: "cancelled" },
    { day_of_week: 3, status: "active" }
  ]);
  assert.equal(mondayRequest.rows[0].status, "rejected");
  assert.equal(scheduledMondayAttendance.rows[0].count, 0);
  assert.equal(scheduledWednesdayAttendance.rows[0].count, 4);

  await clientsService.updatePreferences(client.id, {
    preferredDays: ["Monday"],
    preferredSchedule: { Monday: ["11:00"] }
  });

  const pendingAfterReadd = await pendingForClient(client.id);
  assert.deepEqual(pendingAfterReadd.map((request) => request.day), ["Monday"]);
});

test("rejecting preferred slots removes them from the client preferences", async () => {
  const client = await createClient({
    suffix: "reject-removes-preference",
    packageSize: 4,
    preferredDays: ["Monday", "Wednesday"],
    preferredSchedule: {
      Monday: ["08:00", "09:00"],
      Wednesday: ["10:00"]
    }
  });
  const requests = await pendingForClient(client.id);

  await requestsService.reject(
    requests.find((request) => request.day === "Monday" && request.startTime === "08:00").id
  );
  const afterFirstRejection = await clientsService.getClient(client.id);
  assert.deepEqual(afterFirstRejection.preferredDays, ["Monday", "Wednesday"]);
  assert.deepEqual(afterFirstRejection.preferredSchedule, {
    Monday: ["09:00"],
    Wednesday: ["10:00"]
  });

  await requestsService.reject(
    requests.find((request) => request.day === "Monday" && request.startTime === "09:00").id
  );
  const afterSecondRejection = await clientsService.getClient(client.id);
  assert.deepEqual(afterSecondRejection.preferredDays, ["Wednesday"]);
  assert.deepEqual(afterSecondRejection.preferredSchedule, {
    Wednesday: ["10:00"]
  });
});
