import crypto from "crypto";
import { AppError } from "../errors/AppError.js";

export function requestId(req, res, next) {
  const id = req.get?.("x-request-id") || crypto.randomUUID();
  req.id = id;
  res.setHeader("X-Request-Id", id);
  next();
}

export function securityHeaders(req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer-when-downgrade");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
}

export function createRateLimiter({ windowMs, max, keyPrefix = "rate" }) {
  const hits = new Map();
  let nextCleanupAt = 0;

  function cleanupExpiredHits(now) {
    if (now < nextCleanupAt) return;
    nextCleanupAt = now + windowMs;
    for (const [key, value] of hits.entries()) {
      if (value.resetAt <= now) {
        hits.delete(key);
      }
    }
  }

  return function rateLimiter(req, res, next) {
    const now = Date.now();
    cleanupExpiredHits(now);
    const ip = req.ip || req.socket?.remoteAddress || "unknown";
    const key = `${keyPrefix}:${ip}`;
    const current = hits.get(key);

    if (!current || current.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    current.count += 1;
    if (current.count > max) {
      const retryAfterSeconds = Math.ceil((current.resetAt - now) / 1000);
      res.setHeader("Retry-After", String(retryAfterSeconds));
      return next(new AppError(429, "RATE_LIMITED", "Too many requests. Please try again later."));
    }

    return next();
  };
}
