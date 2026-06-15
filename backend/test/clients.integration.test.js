import assert from "node:assert/strict";
import { after, test } from "node:test";
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
const service = createClientsService(createClientsRepository(testPool));
const requestsService = createBookingRequestsService(createBookingRequestsRepository(testPool));
const sessionsService = createSessionsService(createSessionsRepository(testPool));

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
      purchaseDate: "2026-06-14",
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
    assert.equal(stored.purchaseDate, "2026-06-14");
    assert.equal(stored.expiryDate, "2026-08-14");
    assert.equal(packageResult.rows[0].sessions_total, 4);
    assert.equal(packageResult.rows[0].paid, false);
    assert.equal(packageResult.rows[0].purchase_date, "2026-06-14");
    assert.equal(packageResult.rows[0].expiry_date, "2026-08-14");
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
      purchaseDate: "2026-06-14",
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
        sessionDate: "2026-07-20",
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
         AND session.session_date = '2026-07-20'`,
      [created.id]
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
      purchaseDate: "2026-06-14",
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
