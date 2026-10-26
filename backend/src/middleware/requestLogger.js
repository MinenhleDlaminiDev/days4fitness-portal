// OPS-01: liveness and readiness are each probed every 30 seconds, so the
// service answers four health requests a minute and roughly 5,800 a day. Every
// one used to write an info line, which buried real traffic. A successful probe
// is worth nothing in the log. A failing one is the single thing most worth
// seeing, so only success is skipped.
const HEALTH_PATHS = new Set(["/api/health", "/api/health/ready"]);

function isSuccessfulHealthProbe(req, res) {
  if (res.statusCode >= 400) return false;
  // originalUrl carries the query string, so `/api/health?probe=1` has to be
  // matched on its path alone. Compared whole rather than by prefix: a later
  // route such as /api/healthcheck must keep logging. A single trailing slash
  // is tolerated because it reaches the same handler and a probe can be
  // configured either way.
  const path = req.originalUrl.split("?")[0].replace(/\/$/, "");
  return HEALTH_PATHS.has(path || "/");
}

export function requestLogger(req, res, next) {
  const startedAt = Date.now();
  res.on("finish", () => {
    if (isSuccessfulHealthProbe(req, res)) return;
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
