import cors from "cors";
import express from "express";
import { env } from "./config/env.js";
import { AppError } from "./errors/AppError.js";
import apiRoutes from "./routes/index.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { sendData } from "./lib/apiResponse.js";

const app = express();

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
app.use(express.json());

app.get("/", (req, res) => {
  sendData(res, { message: "Days4Fitness API is running" });
});

app.use("/api", apiRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
