import { env } from "../config/env.js";
import { AppError, validationError } from "../errors/AppError.js";
import {
  createSessionToken,
  hashPassword,
  hashSessionToken,
  verifyPassword
} from "../lib/password.js";
import { verifyGoogleCredential } from "../lib/googleAuth.js";
import { authRepository } from "../repositories/auth.repository.js";

function userDto(row) {
  return {
    id: row.user_id ?? row.id,
    email: row.email,
    name: row.name,
    role: row.role
  };
}

function requireCredentials(input = {}) {
  const email = String(input.email || "").trim().toLowerCase();
  const password = String(input.password || "");
  if (!email || !password) {
    throw validationError("Email and password are required");
  }
  return { email, password };
}

export function createAuthService(
  repository = authRepository,
  { googleVerifier = verifyGoogleCredential } = {}
) {
  let bootstrapPromise = null;

  async function ensureBootstrapTrainer() {
    if (!env.trainerBootstrapEmail || !env.trainerBootstrapPassword) return;
    if (!bootstrapPromise) {
      bootstrapPromise = (async () => {
        const count = await repository.countTrainerUsers();
        if (count > 0) return;
        await repository.createTrainerUser({
          email: env.trainerBootstrapEmail,
          name: env.trainerBootstrapName,
          role: "admin",
          passwordHash: hashPassword(env.trainerBootstrapPassword)
        });
      })();
    }
    await bootstrapPromise;
  }

  async function createAuthenticatedSession(user) {
    const token = createSessionToken();
    const tokenHash = hashSessionToken(token);
    const expiresAt = new Date(
      Date.now() + env.authSessionHours * 60 * 60 * 1000
    ).toISOString();
    const session = await repository.createSession({
      userId: user.id,
      tokenHash,
      expiresAt
    });
    await repository.updateLastLogin(user.id);
    return {
      token,
      expiresAt: session.expires_at,
      user: userDto(user)
    };
  }

  async function login(input) {
    await ensureBootstrapTrainer();
    const { email, password } = requireCredentials(input);
    const user = await repository.findUserByEmail(email);
    if (!user || !user.is_active || !verifyPassword(password, user.password_hash)) {
      throw new AppError(401, "INVALID_CREDENTIALS", "Invalid email or password");
    }

    return createAuthenticatedSession(user);
  }

  async function googleLogin(input = {}) {
    const credential = String(input.credential || "");
    if (!credential) throw validationError("Google credential is required");
    const googleUser = await googleVerifier(credential);
    if (!googleUser.emailVerified) {
      throw new AppError(401, "GOOGLE_EMAIL_NOT_VERIFIED", "Google email is not verified");
    }
    if (!googleUser.email.endsWith("@gmail.com")) {
      throw new AppError(403, "GOOGLE_GMAIL_REQUIRED", "Use a Gmail account for trainer access");
    }

    const user = await repository.findOrCreateTrainerUser({
      email: googleUser.email,
      name: googleUser.name,
      role: "trainer",
      passwordHash: hashPassword(createSessionToken())
    });
    if (!user?.is_active) {
      throw new AppError(403, "TRAINER_ACCOUNT_INACTIVE", "Trainer account is inactive");
    }
    return createAuthenticatedSession(user);
  }

  async function authenticateToken(token) {
    if (!token) {
      throw new AppError(401, "AUTHENTICATION_REQUIRED", "Authentication is required");
    }
    const session = await repository.findActiveSessionByTokenHash(hashSessionToken(token));
    if (!session || !session.is_active) {
      throw new AppError(401, "INVALID_SESSION", "Session is invalid or expired");
    }
    return {
      sessionId: session.session_id,
      user: userDto(session)
    };
  }

  return {
    login,
    googleLogin,

    async googleSignup(input = {}) {
      return googleLogin(input);
    },
    authenticateToken,

    async me(token) {
      const session = await authenticateToken(token);
      return session.user;
    },

    async logout(token) {
      if (token) await repository.revokeSession(hashSessionToken(token));
      return { loggedOut: true };
    }
  };
}

export const authService = createAuthService();
