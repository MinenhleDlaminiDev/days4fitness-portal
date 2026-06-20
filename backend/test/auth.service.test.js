import assert from "node:assert/strict";
import test from "node:test";
import { createAuthService } from "../src/services/auth.service.js";

function fakeRepository() {
  const state = {
    users: [],
    sessions: []
  };

  return {
    state,
    async countTrainerUsers() {
      return state.users.length;
    },
    async createTrainerUser(user) {
      const row = {
        id: state.users.length + 1,
        email: user.email.toLowerCase(),
        name: user.name,
        role: user.role,
        password_hash: user.passwordHash,
        is_active: true
      };
      state.users.push(row);
      return row;
    },
    async findOrCreateTrainerUser(user) {
      const existing = state.users.find((item) => item.email === user.email.toLowerCase());
      if (existing) {
        existing.name = user.name || existing.name;
        return existing;
      }
      return this.createTrainerUser(user);
    },
    async findUserByEmail(email) {
      return state.users.find((user) => user.email === email.toLowerCase()) || null;
    },
    async createSession(session) {
      const row = {
        id: state.sessions.length + 1,
        session_id: state.sessions.length + 1,
        token_hash: session.tokenHash,
        trainer_user_id: session.userId,
        expires_at: session.expiresAt,
        revoked_at: null
      };
      state.sessions.push(row);
      return row;
    },
    async findActiveSessionByTokenHash(tokenHash) {
      const session = state.sessions.find(
        (item) => item.token_hash === tokenHash && !item.revoked_at && new Date(item.expires_at) > new Date()
      );
      if (!session) return null;
      const user = state.users.find((item) => item.id === session.trainer_user_id);
      return {
        session_id: session.id,
        expires_at: session.expires_at,
        user_id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        is_active: user.is_active
      };
    },
    async revokeSession(tokenHash) {
      for (const session of state.sessions) {
        if (session.token_hash === tokenHash) session.revoked_at = new Date().toISOString();
      }
    },
    async updateLastLogin(userId) {
      const user = state.users.find((item) => item.id === userId);
      if (user) user.last_login_at = new Date().toISOString();
    }
  };
}

test("bootstraps a trainer and creates a revocable session on login", async () => {
  const repository = fakeRepository();
  const service = createAuthService(repository);

  const loggedIn = await service.login({
    email: "trainer@days4fitness.local",
    password: "ChangeMe123!"
  });

  assert.equal(repository.state.users.length, 1);
  assert.equal(loggedIn.user.email, "trainer@days4fitness.local");
  assert.equal(loggedIn.user.role, "admin");
  assert.ok(loggedIn.token);

  const currentUser = await service.me(loggedIn.token);
  assert.equal(currentUser.email, "trainer@days4fitness.local");

  await service.logout(loggedIn.token);
  await assert.rejects(() => service.me(loggedIn.token), {
    code: "INVALID_SESSION"
  });
});

test("rejects invalid trainer credentials", async () => {
  const service = createAuthService(fakeRepository());

  await assert.rejects(
    () =>
      service.login({
        email: "trainer@days4fitness.local",
        password: "wrong-password"
      }),
    { code: "INVALID_CREDENTIALS" }
  );
});

test("allows verified Gmail Google sign-in during testing mode", async () => {
  const repository = fakeRepository();
  const service = createAuthService(repository, {
    googleVerifier: async () => ({
      email: "newtrainer@gmail.com",
      name: "New Trainer",
      emailVerified: true
    })
  });

  const loggedIn = await service.googleLogin({ credential: "fake-google-token" });

  assert.equal(loggedIn.user.email, "newtrainer@gmail.com");
  assert.equal(loggedIn.user.name, "New Trainer");
  assert.equal(loggedIn.user.role, "trainer");
  assert.equal(repository.state.users.length, 1);
});

test("allows verified Gmail Google sign-up during testing mode", async () => {
  const repository = fakeRepository();
  const service = createAuthService(repository, {
    googleVerifier: async () => ({
      email: "signuptrainer@gmail.com",
      name: "Signup Trainer",
      emailVerified: true
    })
  });

  const signedUp = await service.googleSignup({ credential: "fake-google-token" });

  assert.equal(signedUp.user.email, "signuptrainer@gmail.com");
  assert.equal(signedUp.user.role, "trainer");
  assert.ok(signedUp.token);
});

test("auth helper methods are safe when called without service binding", async () => {
  const repository = fakeRepository();
  const service = createAuthService(repository, {
    googleVerifier: async () => ({
      email: "unboundtrainer@gmail.com",
      name: "Unbound Trainer",
      emailVerified: true
    })
  });
  const { googleSignup, me } = service;

  const signedUp = await googleSignup({ credential: "fake-google-token" });
  const currentUser = await me(signedUp.token);

  assert.equal(currentUser.email, "unboundtrainer@gmail.com");
});

test("rejects Google sign-in for non-Gmail accounts during testing mode", async () => {
  const service = createAuthService(fakeRepository(), {
    googleVerifier: async () => ({
      email: "trainer@example.com",
      name: "Example Trainer",
      emailVerified: true
    })
  });

  await assert.rejects(
    () => service.googleLogin({ credential: "fake-google-token" }),
    { code: "GOOGLE_GMAIL_REQUIRED" }
  );
});
