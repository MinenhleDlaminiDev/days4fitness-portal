import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { getSettings, resetSettings } from "../src/config/settingsCache.js";
import { createConfigurationService } from "../src/services/configuration.service.js";

// Reading configuration refreshes the process-wide settings snapshot, so each
// test has to put it back or it leaks into the other service suites.
afterEach(() => {
  resetSettings();
});

function createRepository(overrides = {}) {
  return {
    async listPrograms() {
      return [{ id: 1, name: "Weight Loss", type: "one_on_one" }];
    },
    async listPricing() {
      return [{ program_type: "one_on_one", sessions_total: 4, price: "1520.00" }];
    },
    async listPackageSizes() {
      return [1, 4, 8, 12, 16];
    },
    async listBusinessHours() {
      return [
        { day_of_week: 1, start_time: "05:00" },
        { day_of_week: 1, start_time: "06:00" },
        { day_of_week: 6, start_time: "05:00" },
        { day_of_week: 6, start_time: "10:00" }
      ];
    },
    async getSchedulingSettings() {
      return { group_capacity: 10, session_duration_minutes: 60, package_expiry_months: 2 };
    },
    async updatePricing() {},
    async replaceBusinessHours() {},
    async updateSchedulingSettings() {},
    ...overrides
  };
}

test("returns database programs, pricing, sizes and hours", async () => {
  const service = createConfigurationService(createRepository());

  const configuration = await service.getConfiguration();

  assert.deepEqual(configuration.programs, [
    { id: 1, name: "Weight Loss", sessionType: "One-on-One" }
  ]);
  assert.equal(configuration.pricing[0].price, 1520);
  assert.deepEqual(configuration.packageSizes, [1, 4, 8, 12, 16]);
  assert.equal(configuration.businessHours.at(-1).day, "Saturday");
  assert.equal(configuration.businessHours.at(-1).timeSlots.at(-1), "10:00");
  assert.equal(configuration.groupCapacity, 10);
  assert.equal(configuration.sessionDurationMinutes, 60);
  assert.equal(configuration.packageExpiryMonths, 2);
});

test("reading configuration refreshes the snapshot the booking rules use", async () => {
  const service = createConfigurationService(
    createRepository({
      async listPackageSizes() {
        return [6];
      },
      async getSchedulingSettings() {
        return { group_capacity: 12, session_duration_minutes: 45, package_expiry_months: 3 };
      }
    })
  );

  await service.getConfiguration();

  assert.deepEqual(getSettings().packageSizes, [6]);
  assert.equal(getSettings().groupCapacity, 12);
  assert.equal(getSettings().packageExpiryMonths, 3);
});

test("saves pricing and rejects bad prices, types, sizes and duplicates", async () => {
  const saved = [];
  const service = createConfigurationService(
    createRepository({
      async updatePricing(entries) {
        saved.push(...entries);
      }
    })
  );

  await service.updatePricing({
    pricing: [{ sessionType: "One-on-One", sessionsTotal: 4, price: "1600.456" }]
  });
  assert.deepEqual(saved, [{ programType: "one_on_one", sessionsTotal: 4, price: 1600.46 }]);

  await assert.rejects(
    service.updatePricing({ pricing: [] }),
    (error) => error.status === 400
  );
  await assert.rejects(
    service.updatePricing({ pricing: [{ sessionType: "Solo", sessionsTotal: 4, price: 1 }] }),
    (error) => error.status === 400
  );
  await assert.rejects(
    service.updatePricing({
      pricing: [{ sessionType: "Group", sessionsTotal: 7, price: 1 }]
    }),
    (error) => error.status === 400
  );
  await assert.rejects(
    service.updatePricing({
      pricing: [{ sessionType: "Group", sessionsTotal: 4, price: -1 }]
    }),
    (error) => error.status === 400
  );
  await assert.rejects(
    service.updatePricing({
      pricing: [
        { sessionType: "Group", sessionsTotal: 4, price: 1 },
        { sessionType: "Group", sessionsTotal: 4, price: 2 }
      ]
    }),
    (error) => error.status === 400
  );
});

test("saves business hours and rejects Sunday, bad times and out-of-range slots", async () => {
  let saved = null;
  const service = createConfigurationService(
    createRepository({
      async replaceBusinessHours(slots) {
        saved = slots;
      }
    })
  );

  await service.updateBusinessHours({
    businessHours: [{ day: "Monday", timeSlots: ["06:00", "07:00"] }]
  });
  assert.deepEqual(saved, [
    { dayOfWeek: 1, startTime: "06:00" },
    { dayOfWeek: 1, startTime: "07:00" }
  ]);

  const rejected = [
    { businessHours: [{ day: "Sunday", timeSlots: ["06:00"] }] },
    { businessHours: [{ day: "Monday", timeSlots: ["6am"] }] },
    { businessHours: [{ day: "Monday", timeSlots: ["04:00"] }] },
    { businessHours: [{ day: "Monday", timeSlots: ["20:00"] }] },
    { businessHours: [{ day: "Saturday", timeSlots: ["11:00"] }] },
    { businessHours: [{ day: "Monday", timeSlots: ["06:00", "06:00"] }] },
    {
      businessHours: [
        { day: "Monday", timeSlots: ["06:00"] },
        { day: "Monday", timeSlots: ["07:00"] }
      ]
    },
    { businessHours: [] },
    { businessHours: "every day" }
  ];
  for (const payload of rejected) {
    await assert.rejects(
      service.updateBusinessHours(payload),
      (error) => error.status === 400,
      `expected ${JSON.stringify(payload)} to be rejected`
    );
  }
});

test("saves scheduling settings and rejects non-positive or absent values", async () => {
  let saved = null;
  const service = createConfigurationService(
    createRepository({
      async updateSchedulingSettings(updates) {
        saved = updates;
      }
    })
  );

  await service.updateSchedulingSettings({ groupCapacity: 12 });
  assert.deepEqual(saved, { groupCapacity: 12 });

  await service.updateSchedulingSettings({ sessionDurationMinutes: 45, packageExpiryMonths: 3 });
  assert.deepEqual(saved, { sessionDurationMinutes: 45, packageExpiryMonths: 3 });

  for (const payload of [
    {},
    { groupCapacity: 0 },
    { groupCapacity: 2.5 },
    { sessionDurationMinutes: -60 },
    { packageExpiryMonths: "two" }
  ]) {
    await assert.rejects(
      service.updateSchedulingSettings(payload),
      (error) => error.status === 400,
      `expected ${JSON.stringify(payload)} to be rejected`
    );
  }
});
