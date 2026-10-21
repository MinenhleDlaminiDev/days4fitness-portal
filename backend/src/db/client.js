import pg from "pg";
import { env } from "../config/env.js";

const { Pool } = pg;

// A managed Postgres requires TLS; the local Docker instance does not offer it.
// DATABASE_SSL decides. When it is unset we add nothing at all, which leaves an
// sslmode already present in DATABASE_URL to speak for itself rather than being
// silently overridden here.
function sslSetting() {
  switch (env.databaseSsl) {
    case "true":
      return { rejectUnauthorized: true };
    case "no-verify":
      // The host signs with its own authority, so the connection is encrypted
      // but the certificate cannot be checked against the public roots.
      return { rejectUnauthorized: false };
    case "false":
      return false;
    default:
      return undefined;
  }
}

const connectionConfig = env.databaseUrl
  ? {
      connectionString: env.databaseUrl
    }
  : {
      host: env.dbHost,
      port: env.dbPort,
      database: env.dbName,
      user: env.dbUser,
      password: env.dbPassword
    };

const ssl = sslSetting();
if (ssl !== undefined) {
  connectionConfig.ssl = ssl;
}

export const pool = new Pool(connectionConfig);

export async function query(text, params = []) {
  return pool.query(text, params);
}
