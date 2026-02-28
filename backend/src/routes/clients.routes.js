import { Router } from "express";
import { query } from "../db/client.js";

const router = Router();

// Example endpoint: list all clients
router.get("/", async (req, res, next) => {
  try {
    const result = await query(
      "SELECT id, name, phone, email, created_at FROM clients ORDER BY created_at DESC"
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

export default router;

