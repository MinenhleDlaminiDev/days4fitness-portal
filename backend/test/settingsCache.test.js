import assert from "node:assert/strict";
import test from "node:test";
import { createSettingsCache, DEFAULTS } from "../src/config/settingsCache.js";

function fakeRepository(perTrainer) {
  const reads = [];
  return {
    reads,
    async listPackageSizes() {
      return [1, 4];
    },
    async listBusinessHours(trainerId) {
      reads.push(trainerId);
      return perTrainer[trainerId]?.hours ?? [{ day_of_week: 1, start_time: "05:00" }];
    },
    async getSchedulingSettings(trainerId) {
      return perTrainer[trainerId]?.settings ?? null;
    }
  };
}

test("serves each trainer their own settings and reads once per trainer", async () => {
  const repository = fakeRepository({
    7: {
      hours: [{ day_of_week: 1, start_time: "06:00" }],
      settings: { group_capacity: 4, session_duration_minutes: 45, package_expiry_months: 3 }
    },
    8: {
      hours: [{ day_of_week: 2, start_time: "18:00" }],
      settings: { group_capacity: 12, session_duration_minutes: 60, package_expiry_months: 1 }
    }
  });
  const cache = createSettingsCache(repository);

  const seven = await cache.getSettings(7);
  const eight = await cache.getSettings(8);

  assert.deepEqual(seven.businessHours, [{ day: "Monday", timeSlots: ["06:00"] }]);
  assert.deepEqual(eight.businessHours, [{ day: "Tuesday", timeSlots: ["18:00"] }]);
  assert.equal(seven.sessionDurationMinutes, 45);
  assert.equal(eight.sessionDurationMinutes, 60);
  assert.equal(seven.packageExpiryMonths, 3);
  assert.equal(eight.packageExpiryMonths, 1);

  // Second reads are served from the cache.
  await cache.getSettings(7);
  await cache.getSettings(8);
  assert.deepEqual(repository.reads, [7, 8]);
});

test("concurrent cold reads for one trainer share a single database read", async () => {
  const repository = fakeRepository({});
  const cache = createSettingsCache(repository);

  const [first, second] = await Promise.all([cache.getSettings(7), cache.getSettings(7)]);

  assert.deepEqual(repository.reads, [7], "one read, not one per caller");
  assert.equal(first, second, "and both callers get the same snapshot");
});

test("invalidating one trainer leaves the others cached", async () => {
  const repository = fakeRepository({});
  const cache = createSettingsCache(repository);

  await cache.getSettings(7);
  await cache.getSettings(8);
  cache.invalidateSettings(7);
  await cache.getSettings(7);
  await cache.getSettings(8);

  assert.deepEqual(repository.reads, [7, 8, 7]);
});

test("a failed read is not cached as a failure", async () => {
  // AUTH-01 again: a stored rejection would leave one trainer unable to book
  // until the process restarted, with everybody else working fine.
  let failNext = true;
  const cache = createSettingsCache({
    async listPackageSizes() {
      return [4];
    },
    async listBusinessHours() {
      if (failNext) {
        failNext = false;
        throw new Error('relation "business_hours" does not exist');
      }
      return [{ day_of_week: 1, start_time: "07:00" }];
    },
    async getSchedulingSettings() {
      return null;
    }
  });

  await assert.rejects(() => cache.getSettings(7), /business_hours/);

  const recovered = await cache.getSettings(7);
  assert.deepEqual(recovered.businessHours, [{ day: "Monday", timeSlots: ["07:00"] }]);
});

test("a trainer with no rows of their own still gets a usable week", async () => {
  const cache = createSettingsCache({
    async listPackageSizes() {
      return [];
    },
    async listBusinessHours() {
      return [];
    },
    async getSchedulingSettings() {
      return null;
    }
  });

  const settings = await cache.getSettings(7);

  assert.deepEqual(settings.businessHours, DEFAULTS.businessHours);
  assert.deepEqual(settings.packageSizes, DEFAULTS.packageSizes);
  assert.equal(settings.sessionDurationMinutes, DEFAULTS.sessionDurationMinutes);
});

test("asking without a trainer is a mistake, not a default", async () => {
  const cache = createSettingsCache(fakeRepository({}));

  // null is the ownership scope of an admin. Read as "no trainer" it would
  // serve somebody arbitrary settings, so it has to be loud.
  await assert.rejects(() => cache.getSettings(null), /per trainer/);
  await assert.rejects(() => cache.getSettings(undefined), /per trainer/);
});
