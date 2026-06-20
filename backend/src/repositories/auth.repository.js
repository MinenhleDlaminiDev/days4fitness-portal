import { pool } from "../db/client.js";

export function createAuthRepository(dbPool = pool) {
  return {
    async countTrainerUsers() {
      const result = await dbPool.query("SELECT COUNT(*)::int AS count FROM trainer_users");
      return result.rows[0].count;
    },

    async createTrainerUser({ email, name, role, passwordHash }) {
      const result = await dbPool.query(
        `INSERT INTO trainer_users (email, name, role, password_hash)
         VALUES (LOWER($1), $2, $3, $4)
         ON CONFLICT (email) DO NOTHING
         RETURNING id, email, name, role, is_active, created_at`,
        [email, name, role, passwordHash]
      );
      return result.rows[0] || null;
    },

    async findOrCreateTrainerUser({ email, name, role, passwordHash }) {
      const result = await dbPool.query(
        `INSERT INTO trainer_users (email, name, role, password_hash)
         VALUES (LOWER($1), $2, $3, $4)
         ON CONFLICT (email) DO UPDATE
           SET name = COALESCE(NULLIF(EXCLUDED.name, ''), trainer_users.name)
         RETURNING id, email, name, role, is_active, created_at`,
        [email, name, role, passwordHash]
      );
      return result.rows[0];
    },

    async findUserByEmail(email) {
      const result = await dbPool.query(
        `SELECT id, email, name, role, password_hash, is_active
         FROM trainer_users
         WHERE email = LOWER($1)
         LIMIT 1`,
        [email]
      );
      return result.rows[0] || null;
    },

    async createSession({ userId, tokenHash, expiresAt }) {
      const result = await dbPool.query(
        `INSERT INTO trainer_sessions (trainer_user_id, token_hash, expires_at)
         VALUES ($1, $2, $3)
         RETURNING id, expires_at`,
        [userId, tokenHash, expiresAt]
      );
      return result.rows[0];
    },

    async findActiveSessionByTokenHash(tokenHash) {
      const result = await dbPool.query(
        `SELECT
           session.id AS session_id,
           session.expires_at,
           user_account.id AS user_id,
           user_account.email,
           user_account.name,
           user_account.role,
           user_account.is_active
         FROM trainer_sessions session
         JOIN trainer_users user_account ON user_account.id = session.trainer_user_id
         WHERE session.token_hash = $1
           AND session.revoked_at IS NULL
           AND session.expires_at > NOW()
         LIMIT 1`,
        [tokenHash]
      );
      return result.rows[0] || null;
    },

    async revokeSession(tokenHash) {
      await dbPool.query(
        `UPDATE trainer_sessions
         SET revoked_at = NOW()
         WHERE token_hash = $1
           AND revoked_at IS NULL`,
        [tokenHash]
      );
    },

    async updateLastLogin(userId) {
      await dbPool.query(
        "UPDATE trainer_users SET last_login_at = NOW() WHERE id = $1",
        [userId]
      );
    }
  };
}

export const authRepository = createAuthRepository();
