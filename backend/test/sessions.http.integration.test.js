import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import express from "express";
import pg from "pg";
import { env } from "../src/config/env.js";
import { createSessionsController } from "../src/controllers/sessions.controller.js";
import { errorHandler, notFoundHandler } from "../src/middleware/errorHandler.js";
import { createSessionsRepository } from "../src/repositories/sessions.repository.js";
import { createSessionsRouter } from "../src/routes/sessions.routes.js";
import { createSessionsService } from "../src/services/sessions.service.js";

const { Pool } = pg;

if (!env.testDatabaseUrl || !new URL(env.testDatabaseUrl).pathname.toLowerCase().includes("test")) {
  throw new Error("Session HTTP integration tests require a safe TEST_DATABASE_URL");
}

const testPool = new Pool({ connectionString: env.testDatabaseUrl });
const service = createSessionsService(createSessionsRepository(testPool));
const controller = createSessionsController(service);
const app = express();
const createdClientIds = [];
let server;
let baseUrl;

app.use(express.json());
app.use("/api/sessions", createSessionsRouter(controller));
app.use(notFoundHandler);
app.use(errorHandler);

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterEach(async () => {
  if (createdClientIds.length > 0) {
    await testPool.query("DELETE FROM clients WHERE id = ANY($1::bigint[])", [createdClientIds]);
    createdClientIds.length = 0;
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

async function createClientPackage() {
  const clientResult = await testPool.query(
    `INSERT INTO clients (name, phone, email)
     VALUES ('Phase 4 HTTP Client', '+27 82 444 9100', $1)
     RETURNING id`,
    [`phase4-http-${Date.now()}@example.com`]
  );
  const clientId = clientResult.rows[0].id;
  createdClientIds.push(clientId);
  const programResult = await testPool.query(
    "SELECT id FROM programs WHERE type = 'one_on_one' ORDER BY id LIMIT 1"
  );
  await testPool.query(
    `INSERT INTO packages (
       client_id,
       program_id,
       sessions_total,
       price,
       paid,
       purchase_date,
       expiry_date
     )
     VALUES ($1, $2, 8, 3040, true, CURRENT_DATE, CURRENT_DATE + INTERVAL '2 months')`,
    [clientId, programResult.rows[0].id]
  );
  return clientId;
}

async function requestJson(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: options.body ? { "content-type": "application/json" } : undefined
  });
  return { status: response.status, body: await response.json() };
}

async function createSession(clientId, sessionDate, startTime) {
  return requestJson("/api/sessions", {
    method: "POST",
    body: JSON.stringify({ clientId, sessionDate, startTime })
  });
}

test("session HTTP routes expose schedule operations with standard envelopes", async () => {
  const clientId = await createClientPackage();
  const created = await createSession(clientId, "2026-07-06", "11:00");
  assert.equal(created.status, 201);
  assert.equal(created.body.data.attendees[0].clientId, Number(clientId));

  const sessionId = created.body.data.id;
  const fetched = await requestJson(`/api/sessions/${sessionId}`);
  assert.equal(fetched.status, 200);
  assert.equal(fetched.body.data.id, sessionId);

  const week = await requestJson("/api/sessions?weekStart=2026-07-06");
  assert.equal(week.status, 200);
  assert.ok(week.body.data.some((session) => session.id === sessionId));

  const rescheduled = await requestJson(`/api/sessions/${sessionId}/reschedule`, {
    method: "POST",
    body: JSON.stringify({ sessionDate: "2026-07-08", startTime: "12:00" })
  });
  assert.equal(rescheduled.status, 201);
  assert.equal(rescheduled.body.data.rescheduledFromSessionId, sessionId);

  const cancelled = await requestJson(
    `/api/sessions/${rescheduled.body.data.id}/cancel`,
    { method: "POST" }
  );
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.data.status, "cancelled");

  const replacement = await requestJson(
    `/api/sessions/${rescheduled.body.data.id}/replacement`,
    {
      method: "POST",
      body: JSON.stringify({ sessionDate: "2026-07-10", startTime: "13:00" })
    }
  );
  assert.equal(replacement.status, 201);

  const completedSession = await createSession(clientId, "2026-07-13", "14:00");
  await testPool.query(
    "UPDATE sessions SET session_date = CURRENT_DATE - 3 WHERE id = $1",
    [completedSession.body.data.id]
  );
  const completed = await requestJson(
    `/api/sessions/${completedSession.body.data.id}/complete`,
    {
      method: "POST",
      body: JSON.stringify({ clientId })
    }
  );
  assert.equal(completed.status, 200);
  assert.equal(completed.body.data.status, "completed");

  const noShowSession = await createSession(clientId, "2026-07-14", "15:00");
  await testPool.query(
    "UPDATE sessions SET session_date = CURRENT_DATE - 3 WHERE id = $1",
    [noShowSession.body.data.id]
  );
  const noShow = await requestJson(`/api/sessions/${noShowSession.body.data.id}/no-show`, {
    method: "POST",
    body: JSON.stringify({ clientId })
  });
  assert.equal(noShow.status, 200);
  assert.equal(noShow.body.data.status, "no_show");
});

test("session HTTP routes return validation, conflict, and not-found errors", async () => {
  const clientId = await createClientPackage();
  const invalidWeek = await requestJson("/api/sessions?weekStart=2026-07-07");
  assert.equal(invalidWeek.status, 400);
  assert.equal(invalidWeek.body.error.code, "VALIDATION_ERROR");

  const futureSession = await createSession(clientId, "2026-07-20", "16:00");
  const prematureOutcome = await requestJson(
    `/api/sessions/${futureSession.body.data.id}/complete`,
    {
      method: "POST",
      body: JSON.stringify({ clientId })
    }
  );
  assert.equal(prematureOutcome.status, 409);
  assert.equal(prematureOutcome.body.error.code, "CONFLICT");

  const missing = await requestJson("/api/sessions/999999999/cancel", { method: "POST" });
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error.code, "NOT_FOUND");
});
