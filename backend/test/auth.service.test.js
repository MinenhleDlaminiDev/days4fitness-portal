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
      // Mirrors ON CONFLICT (email) DO NOTHING ... RETURNING: null when taken.
      const email = user.email.toLowerCase();
      if (state.users.some((item) => item.email === email)) return null;
      const row = {
        id: state.users.length + 1,
        email,
        name: user.name,
        role: user.role,
        password_hash: user.passwordHash,
        is_active: true
      };
      state.users.push(row);
      return row;
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

test("signs an existing trainer in with Google", async () => {
  const repository = fakeRepository();
  // Seeded first, because signing in no longer creates the account.
  await repository.createTrainerUser({
    email: "newtrainer@gmail.com",
    name: "New Trainer",
    role: "trainer",
    passwordHash: "unused"
  });
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
    }),
    allowedEmails: ["signuptrainer@gmail.com"]
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
    }),
    allowedEmails: ["unboundtrainer@gmail.com"]
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

test("retries the bootstrap after a failure instead of caching the rejection", async () => {
  const repository = fakeRepository();
  let createCalls = 0;
  let failNextCount = true;

  const flaky = {
    ...repository,
    async countTrainerUsers() {
      if (failNextCount) {
        failNextCount = false;
        throw new Error('relation "trainer_users" does not exist');
      }
      return repository.countTrainerUsers();
    },
    async createTrainerUser(user) {
      createCalls += 1;
      return repository.createTrainerUser(user);
    }
  };

  const service = createAuthService(flaky);
  const credentials = {
    email: "trainer@days4fitness.local",
    password: "ChangeMe123!"
  };

  // The first attempt fails on the database, not on the credentials.
  await assert.rejects(() => service.login(credentials), {
    code: "BOOTSTRAP_UNAVAILABLE"
  });
  assert.equal(createCalls, 0);

  // The cause has gone away, so the next login must try again rather than
  // replay the stored rejection.
  const loggedIn = await service.login(credentials);
  assert.equal(loggedIn.user.email, "trainer@days4fitness.local");
  assert.equal(createCalls, 1);
  assert.equal(repository.state.users.length, 1);
});

test("shares one bootstrap between concurrent first logins", async () => {
  const repository = fakeRepository();
  let createCalls = 0;

  const counted = {
    ...repository,
    async countTrainerUsers() {
      // Yield, so both logins get past the count before either one inserts.
      await new Promise((resolve) => setImmediate(resolve));
      return repository.countTrainerUsers();
    },
    async createTrainerUser(user) {
      createCalls += 1;
      return repository.createTrainerUser(user);
    }
  };

  const service = createAuthService(counted);
  const credentials = {
    email: "trainer@days4fitness.local",
    password: "ChangeMe123!"
  };

  const [first, second] = await Promise.all([
    service.login(credentials),
    service.login(credentials)
  ]);

  assert.ok(first.token);
  assert.ok(second.token);
  assert.equal(createCalls, 1, "the trainer must only be created once");
  assert.equal(repository.state.users.length, 1);
});

function googleServiceFor(email, options = {}) {
  const repository = fakeRepository();
  const service = createAuthService(repository, {
    googleVerifier: async () => ({ email, name: "Someone", emailVerified: true }),
    ...options
  });
  return { repository, service };
}

test("Google sign-in does not create an account for an unknown address", async () => {
  const { repository, service } = googleServiceFor("stranger@gmail.com");

  await assert.rejects(() => service.googleLogin({ credential: "token" }), {
    code: "TRAINER_NOT_REGISTERED"
  });
  // The actual exposure was the side effect, not the error: a stranger used to
  // be registered simply by signing in.
  assert.equal(repository.state.users.length, 0);
});

test("Google sign-up refuses an address that is not on the allowlist", async () => {
  const { repository, service } = googleServiceFor("stranger@gmail.com", {
    allowedEmails: ["someone.else@gmail.com"]
  });

  await assert.rejects(() => service.googleSignup({ credential: "token" }), {
    code: "TRAINER_NOT_INVITED"
  });
  assert.equal(repository.state.users.length, 0);
});

test("an empty allowlist closes sign-up completely", async () => {
  const { repository, service } = googleServiceFor("stranger@gmail.com", {
    allowedEmails: []
  });

  await assert.rejects(() => service.googleSignup({ credential: "token" }), {
    code: "TRAINER_NOT_INVITED"
  });
  assert.equal(repository.state.users.length, 0);
});

test("an allowlisted address can sign up, and only once", async () => {
  const { repository, service } = googleServiceFor("invited@gmail.com", {
    allowedEmails: ["invited@gmail.com"]
  });

  const first = await service.googleSignup({ credential: "token" });
  assert.equal(first.user.email, "invited@gmail.com");
  assert.equal(repository.state.users.length, 1);

  // Signing up again is just a sign-in, not a second row.
  const second = await service.googleSignup({ credential: "token" });
  assert.equal(second.user.email, "invited@gmail.com");
  assert.equal(repository.state.users.length, 1);
});

test("an inactive trainer is refused on both Google paths", async () => {
  const { repository, service } = googleServiceFor("retired@gmail.com", {
    allowedEmails: ["retired@gmail.com"]
  });
  const user = await repository.createTrainerUser({
    email: "retired@gmail.com",
    name: "Retired",
    role: "trainer",
    passwordHash: "unused"
  });
  user.is_active = false;

  await assert.rejects(() => service.googleLogin({ credential: "token" }), {
    code: "TRAINER_ACCOUNT_INACTIVE"
  });
  await assert.rejects(() => service.googleSignup({ credential: "token" }), {
    code: "TRAINER_ACCOUNT_INACTIVE"
  });
});

// AUTH-07 ------------------------------------------------------------------

const SIGNUP_OPTIONS = { allowedEmails: ["new-trainer@example.com"] };

test("sign-up creates exactly one account, which can then sign in", async () => {
  const repository = fakeRepository();
  const service = createAuthService(repository, SIGNUP_OPTIONS);

  const session = await service.signup({
    email: "New-Trainer@example.com",
    password: "CorrectHorse9",
    name: "New Trainer"
  });

  assert.equal(repository.state.users.length, 1);
  assert.equal(repository.state.users[0].email, "new-trainer@example.com");
  assert.equal(repository.state.users[0].role, "trainer");
  assert.equal(session.user.email, "new-trainer@example.com");
  assert.ok(session.token);

  // The hash must never travel back to the caller.
  assert.equal(JSON.stringify(session).includes("password"), false);

  // Criterion 1: the account works from then on, through the normal login.
  const signedIn = await service.login({
    email: "new-trainer@example.com",
    password: "CorrectHorse9"
  });
  assert.equal(signedIn.user.email, "new-trainer@example.com");
});

test("sign-up refuses a taken email and creates nothing", async () => {
  const repository = fakeRepository();
  const service = createAuthService(repository, SIGNUP_OPTIONS);

  await service.signup({ email: "new-trainer@example.com", password: "CorrectHorse9" });
  assert.equal(repository.state.users.length, 1);

  // Decided on the ticket: this is a plain refusal, so it does disclose that
  // the address is registered. The property worth holding is that no second
  // account appears and the first one's password is untouched.
  await assert.rejects(
    service.signup({ email: "new-trainer@example.com", password: "DifferentPass8" }),
    (error) => error.status === 409 && error.code === "EMAIL_UNAVAILABLE"
  );
  assert.equal(repository.state.users.length, 1);

  const stillTheirs = await service.login({
    email: "new-trainer@example.com",
    password: "CorrectHorse9"
  });
  assert.equal(stillTheirs.user.email, "new-trainer@example.com");
});

test("a password sign-up cannot take over an account created through Google", async () => {
  const repository = fakeRepository();
  const service = createAuthService(repository, {
    allowedEmails: ["via-google@gmail.com"],
    googleVerifier: async () => ({
      email: "via-google@gmail.com",
      name: "Via Google",
      emailVerified: true
    })
  });

  await service.googleSignup({ credential: "token" });
  const originalHash = repository.state.users[0].password_hash;

  await assert.rejects(
    service.signup({ email: "via-google@gmail.com", password: "TakeOver123" }),
    (error) => error.code === "EMAIL_UNAVAILABLE"
  );

  assert.equal(repository.state.users.length, 1);
  assert.equal(repository.state.users[0].password_hash, originalHash);
  // And the password the attacker chose does not work.
  await assert.rejects(
    service.login({ email: "via-google@gmail.com", password: "TakeOver123" }),
    (error) => error.code === "INVALID_CREDENTIALS"
  );
});

test("sign-up rejects weak passwords and bad emails without creating anything", async () => {
  const repository = fakeRepository();
  const service = createAuthService(repository, SIGNUP_OPTIONS);

  const rejected = [
    { email: "new-trainer@example.com", password: "short1" },        // too short
    { email: "new-trainer@example.com", password: "allletterspass" }, // no digit
    { email: "new-trainer@example.com", password: "1234567890" },     // no letter
    { email: "not-an-email", password: "CorrectHorse9" }
  ];

  for (const input of rejected) {
    await assert.rejects(service.signup(input), (error) => error.status === 400);
  }
  assert.equal(repository.state.users.length, 0);
});

test("sign-up is still gated on the allowlist until AUTH-08 opens it", async () => {
  const repository = fakeRepository();
  const service = createAuthService(repository, { allowedEmails: [] });

  await assert.rejects(
    service.signup({ email: "stranger@example.com", password: "CorrectHorse9" }),
    (error) => error.status === 403 && error.code === "TRAINER_NOT_INVITED"
  );
  assert.equal(repository.state.users.length, 0);
});

test("sign-up names the account from the email when no name is given", async () => {
  const repository = fakeRepository();
  const service = createAuthService(repository, SIGNUP_OPTIONS);

  await service.signup({ email: "new-trainer@example.com", password: "CorrectHorse9" });
  assert.equal(repository.state.users[0].name, "new-trainer");
});
