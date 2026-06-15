import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import express from "express";
import pg from "pg";
import { env } from "../src/config/env.js";
import { createBookingRequestsController } from "../src/controllers/bookingRequests.controller.js";
import { errorHandler, notFoundHandler } from "../src/middleware/errorHandler.js";
import { createBookingRequestsRepository } from "../src/repositories/bookingRequests.repository.js";
import { createClientsRepository } from "../src/repositories/clients.repository.js";
import { createBookingRequestsRouter } from "../src/routes/bookingRequests.routes.js";
import { createBookingRequestsService } from "../src/services/bookingRequests.service.js";
import { createClientsService } from "../src/services/clients.service.js";

const { Pool } = pg;

if (!env.testDatabaseUrl || !new URL(env.testDatabaseUrl).pathname.toLowerCase().includes("test")) {
  throw new Error("HTTP integration tests require a safe TEST_DATABASE_URL");
}

const testPool = new Pool({ connectionString: env.testDatabaseUrl });
const clientsService = createClientsService(createClientsRepository(testPool));
const requestsService = createBookingRequestsService(createBookingRequestsRepository(testPool));
const controller = createBookingRequestsController(requestsService);
const app = express();
const createdEmails = [];
let server;
let baseUrl;

app.use(express.json());
app.use("/api/booking-requests", createBookingRequestsRouter(controller));
app.use(notFoundHandler);
app.use(errorHandler);

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
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

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  await testPool.end();
});

async function createClient(suffix, day, startTime) {
  const email = `phase3-http-${suffix}-${Date.now()}@example.com`;
  createdEmails.push(email);
  return clientsService.createClient({
    name: `Phase 3 HTTP ${suffix}`,
    phone: "+27 82 777 3000",
    email,
    program: "Weight Loss",
    sessionType: "One-on-One",
    packageSize: 1,
    purchaseDate: new Date().toISOString().slice(0, 10),
    paid: false,
    preferredDays: [day],
    preferredSchedule: { [day]: [startTime] }
  });
}

async function requestJson(path, options) {
  const response = await fetch(`${baseUrl}${path}`, options);
  return { status: response.status, body: await response.json() };
}

test("booking request HTTP routes return standard success and error envelopes", async () => {
  const approvedClient = await createClient("approve", "Tuesday", "06:00");
  const rejectedClient = await createClient("reject", "Thursday", "07:00");

  const pending = await requestJson("/api/booking-requests/pending");
  assert.equal(pending.status, 200);
  assert.ok(Array.isArray(pending.body.data));

  const approvedRequest = pending.body.data.find(
    (request) => request.clientId === approvedClient.id
  );
  const rejectedRequest = pending.body.data.find(
    (request) => request.clientId === rejectedClient.id
  );
  assert.ok(approvedRequest);
  assert.ok(rejectedRequest);

  const approved = await requestJson(
    `/api/booking-requests/${approvedRequest.id}/approve`,
    { method: "POST" }
  );
  assert.equal(approved.status, 200);
  assert.equal(approved.body.data.request.status, "approved");
  assert.ok(approved.body.data.request.reviewedAt);

  const rejected = await requestJson(
    `/api/booking-requests/${rejectedRequest.id}/reject`,
    { method: "POST" }
  );
  assert.equal(rejected.status, 200);
  assert.equal(rejected.body.data.status, "rejected");

  const reviewedAgain = await requestJson(
    `/api/booking-requests/${rejectedRequest.id}/reject`,
    { method: "POST" }
  );
  assert.equal(reviewedAgain.status, 409);
  assert.equal(reviewedAgain.body.error.code, "CONFLICT");

  const invalidId = await requestJson("/api/booking-requests/not-a-number/approve", {
    method: "POST"
  });
  assert.equal(invalidId.status, 400);
  assert.equal(invalidId.body.error.code, "VALIDATION_ERROR");

  const missing = await requestJson("/api/booking-requests/999999999/approve", {
    method: "POST"
  });
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error.code, "NOT_FOUND");
});
