import cors from "cors";
import express from "express";
import { env } from "./config/env.js";
import { AppError } from "./errors/AppError.js";
import apiRoutes from "./routes/index.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { requestLogger } from "./middleware/requestLogger.js";
import { createRateLimiter, requestId, securityHeaders } from "./middleware/security.js";
import { sendData } from "./lib/apiResponse.js";

const app = express();

app.set("trust proxy", env.trustProxy);
app.use(requestId);
app.use(securityHeaders);
app.use(requestLogger);
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || env.corsOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new AppError(403, "CORS_ORIGIN_DENIED", "Origin is not allowed by CORS"));
    }
  })
);
app.use(express.json({ limit: env.requestBodyLimit }));

app.get("/", (req, res) => {
  sendData(res, { message: "Days4Fitness API is running" });
});

app.use(
  "/api/auth",
  createRateLimiter({
    windowMs: env.rateLimitWindowMs,
    max: env.authRateLimitMax,
    keyPrefix: "auth"
  })
);
app.use(
  "/api",
  createRateLimiter({
    windowMs: env.rateLimitWindowMs,
    max: env.rateLimitMax,
    keyPrefix: "api"
  })
);
app.use("/api", apiRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
