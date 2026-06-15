import assert from "node:assert/strict";
import test from "node:test";
import { createClientsService, normalizePreferredSchedule } from "../src/services/clients.service.js";

function clientRow(overrides = {}) {
  return {
    id: 1,
    name: "Test Client",
    phone: "+27 82 000 0000",
    email: "test@example.com",
    preferred_days: ["Monday"],
    preferred_schedule: { Monday: ["08:00"] },
    preference_statuses: [
      { dayOfWeek: 1, startTime: "08:00", status: "pending" }
    ],
    program_name: "Weight Loss",
    program_type: "one_on_one",
    sessions_total: 4,
    sessions_used: 0,
    paid: false,
    purchase_date: "2026-06-01",
    expiry_date: "2026-08-01",
    created_at: "2026-06-01T08:00:00.000Z",
    is_active: true,
    archived_at: null,
    ...overrides
  };
}

test("creates a client with a normalized package and schedule", async () => {
  let capturedClient;
  let capturedPackage;
  const service = createClientsService({
    async createWithPackage(client, packageData) {
      capturedClient = client;
      capturedPackage = packageData;
      return clientRow();
    }
  });

  const result = await service.createClient({
    name: " Test Client ",
    phone: " +27 82 000 0000 ",
    email: " test@example.com ",
    program: "Weight Loss",
    sessionType: "One-on-One",
    packageSize: 4,
    purchaseDate: "2026-06-01",
    paid: false,
    preferredDays: ["Monday", "Monday"],
    preferredSchedule: { Monday: ["08:00", "08:00"] }
  });

  assert.equal(capturedClient.name, "Test Client");
  assert.deepEqual(capturedClient.preferredDays, ["Monday"]);
  assert.deepEqual(capturedClient.preferredSchedule, { Monday: ["08:00"] });
  assert.equal(capturedPackage.programType, "one_on_one");
  assert.equal(capturedPackage.packageSize, 4);
  assert.equal(capturedPackage.expiryMonths, 2);
  assert.equal(result.sessionsTotal, 4);
  assert.deepEqual(result.sessionPreferences, [
    { day: "Monday", startTime: "08:00", status: "pending" }
  ]);
});

test("creates a client without scheduling preferences", async () => {
  let capturedClient;
  const service = createClientsService({
    async createWithPackage(client) {
      capturedClient = client;
      return clientRow({
        preferred_days: [],
        preferred_schedule: {}
      });
    }
  });

  const result = await service.createClient({
    name: "Unscheduled Client",
    phone: "+27 82 000 0001",
    program: "Weight Loss",
    sessionType: "One-on-One",
    packageSize: 4,
    purchaseDate: "2026-06-01"
  });

  assert.deepEqual(capturedClient.preferredDays, []);
  assert.deepEqual(capturedClient.preferredSchedule, {});
  assert.deepEqual(result.preferredDays, []);
});

test("clears existing scheduling preferences", async () => {
  let updatedDays;
  let updatedSchedule;
  const service = createClientsService({
    async findById() {
      return clientRow();
    },
    async updatePreferences(id, preferredDays, preferredSchedule) {
      updatedDays = preferredDays;
      updatedSchedule = preferredSchedule;
      return clientRow({
        preferred_days: [],
        preferred_schedule: {}
      });
    }
  });

  const result = await service.updatePreferences(1, {
    preferredDays: [],
    preferredSchedule: {}
  });

  assert.deepEqual(updatedDays, []);
  assert.deepEqual(updatedSchedule, {});
  assert.deepEqual(result.preferredDays, []);
});

test("lists clients with normalized filters and pagination", async () => {
  let capturedQuery;
  const service = createClientsService({
    async findAll(query) {
      capturedQuery = query;
      return { rows: [clientRow()], total: 21, unpaidTotal: 7 };
    }
  });

  const result = await service.listClients({
    search: " Test ",
    status: "archived",
    packageStatus: "expired",
    page: "2",
    pageSize: "20"
  });

  assert.deepEqual(capturedQuery, {
    search: "Test",
    status: "archived",
    packageStatus: "expired",
    page: 2,
    pageSize: 20
  });
  assert.equal(result.items[0].isActive, true);
  assert.deepEqual(result.summary, { unpaid: 7 });
  assert.deepEqual(result.pagination, {
    page: 2,
    pageSize: 20,
    total: 21,
    totalPages: 2
  });
});

test("updates client contact details", async () => {
  let capturedUpdate;
  const service = createClientsService({
    async update(id, client, preferences) {
      capturedUpdate = { id, client, preferences };
      return clientRow({ name: client.name, phone: client.phone, email: client.email });
    }
  });

  const result = await service.updateClient(1, {
    name: " Updated Client ",
    phone: " +27 82 111 1111 ",
    email: " updated@example.com ",
    preferredDays: ["Tuesday"],
    preferredSchedule: { Tuesday: ["09:00"] }
  });

  assert.deepEqual(capturedUpdate, {
    id: 1,
    client: {
      name: "Updated Client",
      phone: "+27 82 111 1111",
      email: "updated@example.com"
    },
    preferences: {
      preferredDays: ["Tuesday"],
      preferredSchedule: { Tuesday: ["09:00"] }
    }
  });
  assert.equal(result.name, "Updated Client");
});

test("archives a client", async () => {
  const archivedAt = "2026-06-15T08:00:00.000Z";
  const service = createClientsService({
    async setActive(id, isActive) {
      assert.equal(id, 1);
      assert.equal(isActive, false);
      return clientRow({ is_active: false, archived_at: archivedAt });
    }
  });

  const result = await service.setClientActive(1, false);

  assert.equal(result.isActive, false);
  assert.equal(result.archivedAt, archivedAt);
});

test("rejects preference updates for archived clients", async () => {
  const service = createClientsService({
    async updatePreferences() {
      const error = new Error("Archived clients cannot update preferences");
      error.code = "CLIENT_ARCHIVED";
      throw error;
    }
  });

  await assert.rejects(
    service.updatePreferences(1, {
      preferredDays: ["Monday"],
      preferredSchedule: { Monday: ["08:00"] }
    }),
    (error) => error.code === "CONFLICT" && error.status === 409
  );
});

test("maps package and session history", async () => {
  const service = createClientsService({
    async findById() {
      return clientRow();
    },
    async findPackageHistory() {
      return [
        {
          id: 7,
          program_name: "Weight Loss",
          program_type: "one_on_one",
          sessions_total: 4,
          sessions_used: 1,
          price: "1200.00",
          paid: true,
          purchase_date: "2026-06-01",
          expiry_date: "2026-08-01",
          created_at: "2026-06-01T08:00:00.000Z"
        }
      ];
    },
    async findSessionHistory() {
      return [
        {
          id: 9,
          session_date: "2026-06-15",
          start_time: "08:00:00",
          duration_minutes: 60,
          session_status: "completed",
          attendance_status: "completed",
          credit_consumed: true,
          has_started: true,
          has_ended: true,
          package_id: 7,
          program_name: "Weight Loss",
          program_type: "one_on_one"
        }
      ];
    }
  });

  const packages = await service.getPackageHistory(1);
  const sessions = await service.getSessionHistory(1);

  assert.equal(packages[0].price, 1200);
  assert.equal(packages[0].sessionType, "One-on-One");
  assert.equal(sessions[0].startTime, "08:00");
  assert.equal(sessions[0].creditConsumed, true);
  assert.equal(sessions[0].hasEnded, true);
});

test("rejects malformed preference field types", () => {
  assert.throws(
    () => normalizePreferredSchedule("Monday", {}, { allowEmpty: true }),
    (error) =>
      error.code === "VALIDATION_ERROR" &&
      error.details.field === "preferredDays"
  );
  assert.throws(
    () => normalizePreferredSchedule([], [], { allowEmpty: true }),
    (error) =>
      error.code === "VALIDATION_ERROR" &&
      error.details.field === "preferredSchedule"
  );
});

test("rejects schedule entries for unselected days", () => {
  assert.throws(
    () =>
      normalizePreferredSchedule(
        ["Monday"],
        { Monday: ["08:00"], Tuesday: ["09:00"] },
        { allowEmpty: true }
      ),
    (error) =>
      error.code === "VALIDATION_ERROR" &&
      error.details.days.includes("Tuesday")
  );
});

test("rejects Sunday preferences", () => {
  assert.throws(
    () => normalizePreferredSchedule(["Sunday"], { Sunday: ["08:00"] }),
    (error) => error.code === "VALIDATION_ERROR" && error.details.day === "Sunday"
  );
});

test("rejects Saturday sessions that would finish after 11:00", () => {
  assert.throws(
    () => normalizePreferredSchedule(["Saturday"], { Saturday: ["11:00"] }),
    (error) =>
      error.code === "VALIDATION_ERROR" &&
      error.details.day === "Saturday" &&
      error.details.allowedSlots.at(-1) === "10:00"
  );
});

test("requires at least one time for every preferred day", () => {
  assert.throws(
    () => normalizePreferredSchedule(["Tuesday"], { Tuesday: [] }),
    (error) => error.code === "VALIDATION_ERROR" && error.details.day === "Tuesday"
  );
});

test("returns a conflict when the email is already used", async () => {
  const service = createClientsService({
    async createWithPackage() {
      const error = new Error("duplicate");
      error.code = "23505";
      throw error;
    }
  });

  await assert.rejects(
    service.createClient({
      name: "Test Client",
      phone: "+27 82 000 0000",
      email: "test@example.com",
      program: "Weight Loss",
      sessionType: "One-on-One",
      packageSize: 4,
      purchaseDate: "2026-06-01",
      preferredDays: ["Monday"],
      preferredSchedule: { Monday: ["08:00"] }
    }),
    (error) => error.code === "CONFLICT" && error.status === 409
  );
});

test("rejects non-boolean payment values", async () => {
  const service = createClientsService({
    async createWithPackage() {
      throw new Error("repository should not be called");
    }
  });

  await assert.rejects(
    service.createClient({
      name: "Test Client",
      phone: "+27 82 000 0000",
      program: "Weight Loss",
      sessionType: "One-on-One",
      packageSize: 4,
      purchaseDate: "2026-06-01",
      paid: "false"
    }),
    (error) =>
      error.code === "VALIDATION_ERROR" &&
      error.status === 400 &&
      error.details.field === "paid"
  );
});
