import { AppError } from "../errors/AppError.js";

/**
 * The single value every scoped query filters on: `null` for an admin, who
 * sees the whole business, otherwise the trainer's own id.
 *
 * Every scoped query uses the same shape, `($n::bigint IS NULL OR
 * owner = $n)`, so there is one thing to get right rather than one per query.
 */
export function ownerScope(actor) {
  if (!actor?.id) {
    throw new AppError(401, "AUTHENTICATION_REQUIRED", "Authentication is required");
  }
  return actor.role === "admin" ? null : Number(actor.id);
}

/**
 * Guards a repository method against a caller that forgot the scope.
 *
 * `null` means "an admin, no restriction" and must be passed deliberately.
 * `undefined` means somebody forgot, and that has to be a loud failure: read
 * as "no restriction" it would quietly hand one trainer every other trainer's
 * data, which is the exact leak this whole change exists to prevent.
 */
/**
 * The trainer a newly created record belongs to. Distinct from ownerScope:
 * an admin's scope is null, meaning "see everything", but a client an admin
 * creates still has to belong to somebody, and that is the admin.
 */
export function ownerId(actor) {
  if (!actor?.id) {
    throw new AppError(401, "AUTHENTICATION_REQUIRED", "Authentication is required");
  }
  return Number(actor.id);
}

export function requireScope(scope) {
  if (scope === undefined) {
    throw new Error(
      "Ownership scope is required. Pass null explicitly for an admin."
    );
  }
  return scope;
}
