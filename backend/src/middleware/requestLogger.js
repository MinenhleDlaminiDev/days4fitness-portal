export function requestLogger(req, res, next) {
  const startedAt = Date.now();
  res.on("finish", () => {
    const level = res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info";
    const event = {
      level,
      message: "http_request",
      requestId: req.id,
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      durationMs: Date.now() - startedAt
    };
    console[level === "error" ? "error" : "log"](JSON.stringify(event));
  });
  next();
}
