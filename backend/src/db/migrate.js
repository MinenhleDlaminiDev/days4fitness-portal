import { pool } from "./client.js";
import { applyMigrations } from "./migrationRunner.js";

applyMigrations(pool)
  .catch((error) => {
    console.error("Migration failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
