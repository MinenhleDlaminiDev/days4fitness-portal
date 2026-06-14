import { AppError } from "../errors/AppError.js";

export function notFoundHandler(req, res) {
  res.status(404).json({
    error: {
      code: "ROUTE_NOT_FOUND",
      message: `Route not found: ${req.method} ${req.originalUrl}`
    }
  });
}

export function errorHandler(err, req, res, next) {
  if (err?.type === "entity.parse.failed") {
    return res.status(400).json({
      error: {
        code: "INVALID_JSON",
        message: "Request body contains invalid JSON"
      }
    });
  }

  if (err?.type === "entity.too.large") {
    return res.status(413).json({
      error: {
        code: "PAYLOAD_TOO_LARGE",
        message: "Request body exceeds the allowed size"
      }
    });
  }

  const isOperational = err instanceof AppError;
  if (!isOperational) console.error(err);
  const status = isOperational ? err.status : 500;
  res.status(status).json({
    error: {
      code: isOperational ? err.code : "INTERNAL_SERVER_ERROR",
      message: isOperational ? err.message : "Unexpected server error",
      ...(isOperational && err.details ? { details: err.details } : {})
    }
  });
}
