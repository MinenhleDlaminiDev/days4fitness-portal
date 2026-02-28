import app from "./app.js";
import { env } from "./config/env.js";
import { pool } from "./db/client.js";

const server = app.listen(env.port, () => {
  console.log(`API running at http://localhost:${env.port}`);
});

process.on("SIGINT", async () => {
  await pool.end();
  server.close(() => process.exit(0));
});

