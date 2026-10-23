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

// AUTH-07. The rule is stated on the sign-up form too, before anything is
// submitted, so it is only restated here rather than first discovered here.
export const PASSWORD_MIN_LENGTH = 10;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function requireNewCredentials(input = {}) {
  const { email, password } = requireCredentials(input);
  if (!EMAIL_PATTERN.test(email)) {
    throw validationError("Enter a valid email address");
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    throw validationError(`Password must be at least ${PASSWORD_MIN_LENGTH} characters`);
  }
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    throw validationError("Password must contain a letter and a number");
  }
  // trainer_users.name is NOT NULL and the name is what the portal header
  // shows. Falling back to the local part keeps the field optional at the API
  // without ever writing an empty one.
  const name = String(input.name || "").trim() || email.split("@")[0];
  return { email, password, name };
}

export function createAuthService(
  repository = authRepository,
  { googleVerifier = verifyGoogleCredential } = {}
) {
  let bootstrapPromise = null;

  // Single-flight: concurrent first logins share one count-and-create rather
  // than racing to insert the same trainer. A *failure* is deliberately not
  // kept — the slot is cleared so the next login retries. Caching a rejection
  // here once left sign-in returning 500 against a healthy, fully migrated
  // database until the process happened to be restarted.
  async function ensureBootstrapTrainer() {
    if (!env.trainerBootstrapEmail || !env.trainerBootstrapPassword) return;

    if (!bootstrapPromise) {
      const attempt = (async () => {
        const count = await repository.countTrainerUsers();
        if (count > 0) return;
        await repository.createTrainerUser({
          email: env.trainerBootstrapEmail,
          name: env.trainerBootstrapName,
          role: "admin",
          passwordHash: hashPassword(env.trainerBootstrapPassword)
        });
      })();

      bootstrapPromise = attempt.catch((error) => {
        bootstrapPromise = null;
        // AppError is treated as operational and is not logged by the error
        // handler, so the real cause is recorded here before it is replaced.
        console.error("Bootstrap trainer setup failed:", error);
        throw new AppError(
          503,
          "BOOTSTRAP_UNAVAILABLE",
          "Could not prepare the trainer account. Please try again."
        );
      });
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

  async function verifiedGoogleUser(input) {
    const credential = String(input.credential || "");
    if (!credential) throw validationError("Google credential is required");
    const googleUser = await googleVerifier(credential);
    if (!googleUser.emailVerified) {
      throw new AppError(401, "GOOGLE_EMAIL_NOT_VERIFIED", "Google email is not verified");
    }
    if (!googleUser.email.endsWith("@gmail.com")) {
      throw new AppError(403, "GOOGLE_GMAIL_REQUIRED", "Use a Gmail account for trainer access");
    }
    return googleUser;
  }

  function requireActive(user) {
    if (!user?.is_active) {
      throw new AppError(403, "TRAINER_ACCOUNT_INACTIVE", "Trainer account is inactive");
    }
    return user;
  }

  // Signing in must never create an account. It used to, through
  // findOrCreateTrainerUser, which meant any verified Gmail address reaching
  // the portal registered itself and could then see every client.
  async function googleLogin(input = {}) {
    const googleUser = await verifiedGoogleUser(input);
    const user = await repository.findUserByEmail(googleUser.email);
    if (!user) {
      throw new AppError(
        403,
        "TRAINER_NOT_REGISTERED",
        "This account does not have trainer access"
      );
    }
    return createAuthenticatedSession(requireActive(user));
  }

  // Creating an account is the only path that may insert. AUTH-08 opened it to
  // anyone: the TRAINER_ALLOWED_EMAILS allowlist was a lock on the door while
  // the building had no internal walls, and AUTH-03 to AUTH-06 built the walls.
  // A stranger who signs up gets their own empty workspace and can see nothing
  // of anyone else's.
  async function googleSignup(input = {}) {
    const googleUser = await verifiedGoogleUser(input);
    const existing = await repository.findUserByEmail(googleUser.email);
    if (existing) return createAuthenticatedSession(requireActive(existing));

    const created = await repository.createTrainerUser({
      email: googleUser.email,
      name: googleUser.name,
      role: "trainer",
      passwordHash: hashPassword(createSessionToken())
    });
    // createTrainerUser does nothing on conflict, so a race returns null here.
    const user = created || (await repository.findUserByEmail(googleUser.email));
    return createAuthenticatedSession(requireActive(user));
  }

  // AUTH-07. The only path that creates a password account. Sign-IN still
  // never inserts, which is the separation AUTH-02 drew and this does not
  // cross: login verifies, signup creates, and nothing does both.
  //
  // AUTH-08 removed the allowlist from here and from googleSignup together,
  // so registration is open on both paths or neither.
  async function signup(input = {}) {
    const { email, password, name } = requireNewCredentials(input);

    // Decided on the ticket, 2026-10-23: a taken email is refused plainly, so
    // sign-up does reveal whether an address is registered. Answering
    // identically either way cannot return a session -- that would hand over
    // somebody else's account -- so it needs email verification to be usable
    // at all, and no email provider exists yet.
    //
    // The same refusal is what protects an account created through Google:
    // those carry a random password hash, so writing a chosen password over
    // one would be a takeover rather than a sign-up.
    if (await repository.findUserByEmail(email)) {
      throw new AppError(409, "EMAIL_UNAVAILABLE", "That email cannot be used");
    }

    const created = await repository.createTrainerUser({
      email,
      name,
      role: "trainer",
      passwordHash: hashPassword(password)
    });

    // createTrainerUser does nothing on conflict and returns null, so this is
    // the same email taken between the check above and the insert. Same
    // answer, so losing the race does not produce a different message.
    if (!created) {
      throw new AppError(409, "EMAIL_UNAVAILABLE", "That email cannot be used");
    }

    return createAuthenticatedSession(created);
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
    signup,
    googleLogin,
    googleSignup,
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
