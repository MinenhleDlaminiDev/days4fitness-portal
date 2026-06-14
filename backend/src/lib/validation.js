import { validationError } from "../errors/AppError.js";

export function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function requirePositiveInteger(value, fieldName) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw validationError(`${fieldName} must be a positive integer`, { field: fieldName });
  }
  return parsed;
}

export function requireOneOf(value, allowedValues, fieldName) {
  if (!allowedValues.includes(value)) {
    throw validationError(`${fieldName} must be one of: ${allowedValues.join(", ")}`, {
      field: fieldName,
      allowedValues
    });
  }
  return value;
}

export function optionalBoolean(value, fieldName, defaultValue = false) {
  if (value === undefined) return defaultValue;
  if (typeof value !== "boolean") {
    throw validationError(`${fieldName} must be a boolean`, { field: fieldName });
  }
  return value;
}

export function requireIsoDate(value, fieldName) {
  const text = cleanString(value);
  const parsed = new Date(`${text}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(text) ||
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== text
  ) {
    throw validationError(`${fieldName} must be a valid date in YYYY-MM-DD format`, {
      field: fieldName
    });
  }
  return text;
}

export function requireFields(values, fieldNames) {
  const missing = fieldNames.filter((fieldName) => !cleanString(values[fieldName]));
  if (missing.length > 0) {
    throw validationError(`Missing required fields: ${missing.join(", ")}`, { fields: missing });
  }
}
