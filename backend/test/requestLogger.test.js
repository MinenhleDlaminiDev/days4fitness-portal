import assert from "node:assert/strict";
import test from "node:test";
import { requestLogger } from "../src/middleware/requestLogger.js";

// The logger writes on the response's "finish" event, so the double records the
// handler it registers and the test fires it with the status code it wants.
function pair(originalUrl, { method = "GET" } = {}) {
  const res = {
    statusCode: 200,
    handlers: {},
    on(event, handler) {
      this.handlers[event] = handler;
      return this;
    },
    finish(statusCode = 200) {
      this.statusCode = statusCode;
      this.handlers.finish();
    }
  };
  return [{ id: "req-1", method, originalUrl }, res];
}

/** The log lines written while `run` executes, parsed back from JSON. */
function linesFrom(run) {
  const lines = [];
  const { log, error } = console;
  console.log = (line) => lines.push(line);
  console.error = (line) => lines.push(line);
  try {
    run();
  } finally {
    console.log = log;
    console.error = error;
  }
  return lines.map((line) => JSON.parse(line));
}

function logsFor(originalUrl, statusCode) {
  const [req, res] = pair(originalUrl);
  return linesFrom(() => {
    requestLogger(req, res, () => {});
    res.finish(statusCode);
  });
}

test("a successful health probe writes nothing", () => {
  assert.deepEqual(logsFor("/api/health", 200), []);
  assert.deepEqual(logsFor("/api/health/ready", 200), []);
});

test("a query string does not defeat the match", () => {
  // originalUrl carries the query string, and Northflank is free to add one.
  assert.deepEqual(logsFor("/api/health?probe=1", 200), []);
  assert.deepEqual(logsFor("/api/health/ready?x=1&y=2", 200), []);
});

test("a trailing slash does not defeat the match", () => {
  assert.deepEqual(logsFor("/api/health/", 200), []);
});

test("a failing health probe is still logged", () => {
  // The whole point of keeping this: readiness going 503 is what tells you the
  // database is unreachable.
  const ready = logsFor("/api/health/ready", 503);
  assert.equal(ready.length, 1);
  assert.equal(ready[0].level, "error");
  assert.equal(ready[0].status, 503);
  assert.equal(ready[0].path, "/api/health/ready");

  const liveness = logsFor("/api/health", 500);
  assert.equal(liveness.length, 1);
  assert.equal(liveness[0].level, "error");

  const notFound = logsFor("/api/health/ready", 404);
  assert.equal(notFound.length, 1);
  assert.equal(notFound[0].level, "warn");
});

test("a path that merely starts the same is still logged", () => {
  // Matched whole, not by prefix, so a future route cannot be swallowed.
  const probe = logsFor("/api/healthcheck", 200);
  assert.equal(probe.length, 1);
  assert.equal(probe[0].path, "/api/healthcheck");

  const nested = logsFor("/api/health/ready/extra", 200);
  assert.equal(nested.length, 1);
});

test("ordinary requests log exactly as before", () => {
  const ok = logsFor("/api/clients?page=1", 200);
  assert.equal(ok.length, 1);
  assert.equal(ok[0].level, "info");
  assert.equal(ok[0].message, "http_request");
  assert.equal(ok[0].requestId, "req-1");
  assert.equal(ok[0].method, "GET");
  assert.equal(ok[0].path, "/api/clients?page=1");
  assert.equal(ok[0].status, 200);
  assert.equal(typeof ok[0].durationMs, "number");

  const refused = logsFor("/api/clients", 401);
  assert.equal(refused.length, 1);
  assert.equal(refused[0].level, "warn");
});
