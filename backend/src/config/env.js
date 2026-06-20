import dotenv from "dotenv";

dotenv.config();

function list(value, fallback = "") {
  return (value || fallback)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT || 5000),
  businessTimezone: process.env.BUSINESS_TIMEZONE || "Africa/Johannesburg",
  corsOrigins: list(process.env.CORS_ORIGINS, "http://localhost:5173"),
  databaseUrl: process.env.DATABASE_URL || "",
  testDatabaseUrl: process.env.TEST_DATABASE_URL || "",
  dbHost: process.env.DB_HOST || "localhost",
  dbPort: Number(process.env.DB_PORT || 5432),
  dbName: process.env.DB_NAME || "days4fitness",
  dbUser: process.env.DB_USER || "postgres",
  dbPassword: process.env.DB_PASSWORD || "postgres",
  authSessionHours: Number(process.env.AUTH_SESSION_HOURS || 12),
  trainerBootstrapEmail:
    process.env.TRAINER_BOOTSTRAP_EMAIL ||
    (process.env.NODE_ENV === "production" ? "" : "trainer@days4fitness.local"),
  trainerBootstrapName: process.env.TRAINER_BOOTSTRAP_NAME || "Days4Fitness Trainer",
  trainerBootstrapPassword:
    process.env.TRAINER_BOOTSTRAP_PASSWORD ||
    (process.env.NODE_ENV === "production" ? "" : "ChangeMe123!"),
  googleClientId: process.env.GOOGLE_CLIENT_ID || "",
  requestBodyLimit: process.env.REQUEST_BODY_LIMIT || "100kb",
  rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
  rateLimitMax: Number(process.env.RATE_LIMIT_MAX || 300),
  authRateLimitMax: Number(process.env.AUTH_RATE_LIMIT_MAX || 30),
  trustProxy: process.env.TRUST_PROXY === "true"
};

if (
  env.nodeEnv === "production" &&
  (env.corsOrigins.length === 0 || env.corsOrigins.some((origin) => origin.includes("localhost")))
) {
  throw new Error("Production CORS_ORIGINS must contain only production origins");
}
