import { pool } from "../db/client.js";

const CLIENT_SELECT_SQL = `
  SELECT
    c.id,
    c.name,
    c.phone,
    c.email,
    c.preferred_days,
    c.preferred_schedule,
    c.created_at,
    latest_package.sessions_total,
    latest_package.sessions_used,
    latest_package.paid,
    latest_package.purchase_date::text AS purchase_date,
    latest_package.expiry_date::text AS expiry_date,
    program.name AS program_name,
    program.type AS program_type
  FROM clients c
  LEFT JOIN LATERAL (
    SELECT pk.*
    FROM packages pk
    WHERE pk.client_id = c.id
    ORDER BY pk.created_at DESC, pk.id DESC
    LIMIT 1
  ) latest_package ON true
  LEFT JOIN programs program ON program.id = latest_package.program_id
`;

export function createClientsRepository(dbPool = pool) {
  return {
    async findAll() {
      const result = await dbPool.query(`${CLIENT_SELECT_SQL} ORDER BY c.created_at DESC`);
      return result.rows;
    },

    async findById(id, db = dbPool) {
      const result = await db.query(`${CLIENT_SELECT_SQL} WHERE c.id = $1`, [id]);
      return result.rows[0] || null;
    },

    async createWithPackage(clientData, packageData) {
      const db = await dbPool.connect();
      try {
        await db.query("BEGIN");

        const clientResult = await db.query(
          `INSERT INTO clients (name, phone, email, preferred_days, preferred_schedule)
           VALUES ($1, $2, $3, $4, $5::jsonb)
           RETURNING id`,
          [
            clientData.name,
            clientData.phone,
            clientData.email,
            clientData.preferredDays,
            JSON.stringify(clientData.preferredSchedule)
          ]
        );
        const clientId = clientResult.rows[0].id;

        const programResult = await db.query(
          `SELECT id
           FROM programs
           WHERE LOWER(name) = LOWER($1) AND type = $2
           LIMIT 1`,
          [packageData.programName, packageData.programType]
        );

        const priceResult = await db.query(
          `SELECT price
           FROM package_pricing
           WHERE program_type = $1 AND sessions_total = $2
           LIMIT 1`,
          [packageData.programType, packageData.packageSize]
        );

        if (!programResult.rows[0] || !priceResult.rows[0]) {
          const error = new Error("Package configuration is missing");
          error.code = "PACKAGE_CONFIGURATION_MISSING";
          throw error;
        }

        await db.query(
          `INSERT INTO packages (
             client_id,
             program_id,
             sessions_total,
             sessions_used,
             price,
             paid,
             purchase_date,
             expiry_date
           )
           VALUES (
             $1,
             $2,
             $3,
             0,
             $4,
             $5,
             $6::date,
             ($6::date + ($7::int * INTERVAL '1 month'))::date
           )`,
          [
            clientId,
            programResult.rows[0].id,
            packageData.packageSize,
            priceResult.rows[0].price,
            packageData.paid,
            packageData.purchaseDate,
            packageData.expiryMonths
          ]
        );

        const savedClient = await this.findById(clientId, db);
        await db.query("COMMIT");
        return savedClient;
      } catch (error) {
        await db.query("ROLLBACK");
        throw error;
      } finally {
        db.release();
      }
    },

    async updatePreferences(id, preferredDays, preferredSchedule) {
      const updateResult = await dbPool.query(
        `UPDATE clients
         SET preferred_days = $2, preferred_schedule = $3::jsonb
         WHERE id = $1
         RETURNING id`,
        [id, preferredDays, JSON.stringify(preferredSchedule)]
      );
      if (!updateResult.rows[0]) return null;
      return this.findById(id);
    }
  };
}

export const clientsRepository = createClientsRepository();
