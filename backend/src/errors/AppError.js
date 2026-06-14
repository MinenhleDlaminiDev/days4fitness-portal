export class AppError extends Error {
  constructor(status, code, message, details = undefined) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function validationError(message, details) {
  return new AppError(400, "VALIDATION_ERROR", message, details);
}

export function notFoundError(message) {
  return new AppError(404, "NOT_FOUND", message);
}

export function conflictError(message) {
  return new AppError(409, "CONFLICT", message);
}
