import pg from "pg";
import { env } from "../config/env.js";
import { applyMigrations } from "./migrationRunner.js";

const { Pool } = pg;

function requireSafeTestDatabaseUrl(databaseUrl) {
  if (!databaseUrl) {
    throw new Error("TEST_DATABASE_URL is required");
  }

  const databaseName = new URL(databaseUrl).pathname.replace(/^\//, "").toLowerCase();
  if (!databaseName.includes("test")) {
    throw new Error("Refusing to migrate a database whose name does not contain 'test'");
  }
}

async function migrateTestDatabase() {
  requireSafeTestDatabaseUrl(env.testDatabaseUrl);
  const testPool = new Pool({ connectionString: env.testDatabaseUrl });
  try {
    await applyMigrations(testPool);
  } finally {
    await testPool.end();
  }
}

migrateTestDatabase().catch((error) => {
  console.error("Test migration failed:", error);
  process.exitCode = 1;
});
