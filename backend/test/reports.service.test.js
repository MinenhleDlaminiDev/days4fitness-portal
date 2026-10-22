import assert from "node:assert/strict";
import test from "node:test";
import { createReportsService } from "../src/services/reports.service.js";

// AUTH-06 gave getReport the acting user as its last argument, because every
// figure in a report is scoped to whoever asked for it.
const TRAINER = { id: 9, role: "trainer" };
const ADMIN = { id: 1, role: "admin" };

function createRepository(overrides = {}) {
  return {
    async getSummary() {
      return {
        revenue: "4520.00",
        sessions_total: 20,
        sessions_completed: 12,
        sessions_no_show: 3,
        sessions_cancelled: 4,
        sessions_scheduled: 1,
        attendances_total: 25,
        attendances_completed: 15,
        attendances_no_show: 5
      };
    },
    async getClientBreakdown() {
      return [
        {
          id: "7",
          name: "Thandi",
          is_active: true,
          sessions_booked: 6,
          sessions_completed: 5,
          sessions_no_show: 1,
          sessions_cancelled: 0,
          amount_paid: "1520.00"
        }
      ];
    },
    ...overrides
  };
}

test("builds a report with money as numbers and rates over resolved attendance", async () => {
  const service = createReportsService(createRepository());

  const report = await service.getReport({ from: "2026-09-01", to: "2026-09-30" }, TRAINER);

  assert.deepEqual(report.range, { from: "2026-09-01", to: "2026-09-30" });
  assert.equal(report.revenue, 4520);
  assert.equal(report.sessions.completed, 12);
  assert.equal(report.sessions.cancelled, 4);
  // 15 completed and 5 no-shows resolved; the other 5 are still scheduled or
  // cancelled and must not drag the rate down.
  assert.equal(report.attendance.completionRate, 75);
  assert.equal(report.attendance.noShowRate, 25);
  assert.equal(report.clients[0].amountPaid, 1520);
  assert.equal(report.clients[0].name, "Thandi");
});

test("reports no rate rather than zero when nothing resolved in the range", async () => {
  const service = createReportsService(
    createRepository({
      async getSummary() {
        return {
          revenue: "0",
          sessions_total: 2,
          sessions_completed: 0,
          sessions_no_show: 0,
          sessions_cancelled: 0,
          sessions_scheduled: 2,
          attendances_total: 2,
          attendances_completed: 0,
          attendances_no_show: 0
        };
      },
      async getClientBreakdown() {
        return [];
      }
    })
  );

  const report = await service.getReport({ from: "2026-11-01", to: "2026-11-07" }, TRAINER);

  assert.equal(report.attendance.completionRate, null);
  assert.equal(report.attendance.noShowRate, null);
  assert.deepEqual(report.clients, []);
});

test("rejects missing, malformed, inverted and oversized ranges", async () => {
  const service = createReportsService(createRepository());

  for (const query of [
    {},
    { from: "2026-09-01" },
    { to: "2026-09-30" },
    { from: "not-a-date", to: "2026-09-30" },
    { from: "2026-09-31", to: "2026-10-01" },
    { from: "2026-09-30", to: "2026-09-01" },
    { from: "2025-01-01", to: "2026-12-31" }
  ]) {
    await assert.rejects(
      service.getReport(query, TRAINER),
      (error) => error.status === 400,
      `expected ${JSON.stringify(query)} to be rejected`
    );
  }
});

test("accepts a single day and the longest allowed range", async () => {
  const service = createReportsService(createRepository());

  await service.getReport({ from: "2026-09-01", to: "2026-09-01" }, TRAINER);
  await service.getReport({ from: "2026-01-01", to: "2026-12-31" }, TRAINER);
});

test("passes the trainer own id to both queries, and null for an admin", async () => {
  const scopes = [];
  const repository = createRepository({
    async getSummary(range, scope) {
      scopes.push(["summary", scope]);
      return createRepository().getSummary();
    },
    async getClientBreakdown(range, scope) {
      scopes.push(["clients", scope]);
      return createRepository().getClientBreakdown();
    }
  });
  const service = createReportsService(repository);
  const range = { from: "2026-09-01", to: "2026-09-30" };

  await service.getReport(range, TRAINER);
  await service.getReport(range, ADMIN);

  assert.deepEqual(scopes, [
    ["summary", 9],
    ["clients", 9],
    ["summary", null],
    ["clients", null]
  ]);
});

test("refuses to build a report for nobody", async () => {
  const service = createReportsService(createRepository());

  await assert.rejects(
    service.getReport({ from: "2026-09-01", to: "2026-09-30" }),
    (error) => error.status === 401
  );
});
