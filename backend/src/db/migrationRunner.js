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
