import { env } from "../config/env.js";
import { AppError } from "../errors/AppError.js";

export async function verifyGoogleCredential(credential) {
  if (!env.googleClientId) {
    throw new AppError(503, "GOOGLE_AUTH_NOT_CONFIGURED", "Google sign-in is not configured");
  }
  const response = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`
  );
  if (!response.ok) {
    throw new AppError(401, "INVALID_GOOGLE_CREDENTIAL", "Google sign-in could not be verified");
  }
  const payload = await response.json();
  if (payload.aud !== env.googleClientId) {
    throw new AppError(401, "INVALID_GOOGLE_AUDIENCE", "Google sign-in is not for this app");
  }
  return {
    email: String(payload.email || "").toLowerCase(),
    name: payload.name || payload.email,
    emailVerified: payload.email_verified === true || payload.email_verified === "true"
  };
}
