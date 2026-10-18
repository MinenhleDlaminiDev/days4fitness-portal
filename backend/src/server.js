import app from "./app.js";
import { env } from "./config/env.js";
import { pool } from "./db/client.js";
import { configurationService } from "./services/configuration.service.js";

// Booking validation reads the configured hours and package sizes from an
// in-memory snapshot. Warm it before serving so the first request does not
// fall back to the defaults.
try {
  await configurationService.primeCache();
} catch (error) {
  console.warn(`Could not load settings, using defaults: ${error.message}`);
}

const server = app.listen(env.port, () => {
  console.log(`API running at http://localhost:${env.port}`);
});

process.on("SIGINT", async () => {
  await pool.end();
  server.close(() => process.exit(0));
});

