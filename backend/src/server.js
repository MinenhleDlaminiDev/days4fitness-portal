import app from "./app.js";
import { env } from "./config/env.js";
import { pool } from "./db/client.js";
import { applyMigrationsWithLock } from "./db/migrationRunner.js";

// Nothing to warm at boot any more. Settings belong to a trainer since
// AUTH-05, so the cache fills itself per trainer on first use; there is no
// single snapshot to prime and no trainer to prime it for.

// Pending migrations are applied before the port opens. A deploy ships new code
// against whatever schema is already there, and a query for a column a pending
// migration adds fails at runtime, so the schema has to catch up before this
// instance serves anything.
async function start() {
  await applyMigrationsWithLock(pool);

  const server = app.listen(env.port, () => {
    console.log(`API running at http://localhost:${env.port}`);
  });

  process.on("SIGINT", async () => {
    await pool.end();
    server.close(() => process.exit(0));
  });
}

// Exit rather than listen: serving traffic against a schema that is known to be
// behind is what this is here to prevent.
start().catch(async (error) => {
  console.error("Startup failed:", error);
  await pool.end().catch(() => {});
  process.exit(1);
});
