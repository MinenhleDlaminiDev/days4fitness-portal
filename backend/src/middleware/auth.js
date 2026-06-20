import { AppError } from "../errors/AppError.js";
import { authService } from "../services/auth.service.js";

export function bearerToken(req) {
  const header = req.get?.("authorization") || req.headers?.authorization || "";
  const [scheme, token] = header.split(" ");
  return scheme?.toLowerCase() === "bearer" ? token : "";
}

export function createRequireAuth(service = authService) {
  return async function requireAuth(req, res, next) {
    try {
      const token = bearerToken(req);
      if (!token) {
        throw new AppError(401, "AUTHENTICATION_REQUIRED", "Authentication is required");
      }
      const session = await service.authenticateToken(token);
      req.auth = session;
      next();
    } catch (error) {
      next(error);
    }
  };
}

export const requireAuth = createRequireAuth();

export function requireRole(...roles) {
  return function roleGuard(req, res, next) {
    const role = req.auth?.user?.role;
    if (!role || !roles.includes(role)) {
      return next(new AppError(403, "FORBIDDEN", "You do not have permission to access this resource"));
    }
    return next();
  };
}
