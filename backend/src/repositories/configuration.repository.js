import { query } from "../db/client.js";

export const configurationRepository = {
  async listPrograms() {
    const result = await query(
      `SELECT id, name, type
       FROM programs
       ORDER BY name, type`
    );
    return result.rows;
  },

  async listPricing() {
    const result = await query(
      `SELECT program_type, sessions_total, price
       FROM package_pricing
       ORDER BY program_type, sessions_total`
    );
    return result.rows;
  }
};
