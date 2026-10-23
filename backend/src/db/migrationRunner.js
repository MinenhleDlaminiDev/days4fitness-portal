import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function applyMigrations(db, log = console.log) {
  const migrationsDir = path.resolve(__dirname, "../../../database/migrations");
  const files = fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const appliedResult = await db.query("SELECT filename FROM schema_migrations");
  const appliedFiles = new Set(appliedResult.rows.map((row) => row.filename));

  for (const file of files) {
    if (appliedFiles.has(file)) continue;

    const filePath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(filePath, "utf8");
    const shouldAcquireConnection =
      typeof db.connect === "function" && typeof db.release !== "function";
    const connection = shouldAcquireConnection ? await db.connect() : db;

    try {
      await connection.query("BEGIN");
      await connection.query(sql);
      await connection.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
      await connection.query("COMMIT");
      appliedFiles.add(file);
      log(`Applied migration: ${file}`);
    } catch (error) {
      await connection.query("ROLLBACK");
      throw error;
    } finally {
      if (connection !== db && typeof connection.release === "function") {
        connection.release();
      }
    }
  }
}

// A rolling deploy starts several instances at once, so the run is serialised
// on an advisory lock rather than left to race on schema_migrations: the first
// instance applies, the rest wait and then find nothing to do. The lock is
// session-scoped, so it is held on one dedicated connection for the whole run.
// lock_timeout stops a stuck holder from blocking boot forever -- the wait ends
// in an error, the container exits, and the platform retries.
const MIGRATION_LOCK_KEY = 8472013;

export async function applyMigrationsWithLock(pool, log = console.log, waitMs = 60000) {
  const client = await pool.connect();

  try {
    await client.query(`SET lock_timeout = ${Number(waitMs)}`);
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    await applyMigrations(pool, log);
  } finally {
    await client
      .query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY])
      .catch(() => {});
    client.release();
  }
}
