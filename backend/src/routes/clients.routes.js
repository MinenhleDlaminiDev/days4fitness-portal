import { Router } from "express";
import { pool, query } from "../db/client.js";

const router = Router();
const SESSION_TYPE_MAP = {
  "One-on-One": "one_on_one",
  Group: "group"
};
const SESSION_TYPE_LABEL_MAP = {
  one_on_one: "One-on-One",
  group: "Group"
};
const PROGRAM_ALIASES = {
  "Toning and Shaping": "Toning & Shaping"
};
const VALID_PACKAGE_SIZES = new Set([1, 4, 8, 12, 16]);
const VALID_WEEK_DAYS = new Set([
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday"
]);
const WEEKDAY_TIME_SLOTS = new Set(
  Array.from({ length: 15 }, (_, index) => `${String(index + 5).padStart(2, "0")}:00`)
);
const SATURDAY_TIME_SLOTS = new Set(
  Array.from({ length: 6 }, (_, index) => `${String(index + 5).padStart(2, "0")}:00`)
);

function formatDate(value) {
  if (!value) return null;
  if (typeof value === "string") return value.slice(0, 10);
  return new Date(value).toISOString().slice(0, 10);
}

function toClientDto(row) {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone ?? "",
    email: row.email ?? "",
    preferredDays: Array.isArray(row.preferred_days) ? row.preferred_days : [],
    preferredSchedule:
      row.preferred_schedule && typeof row.preferred_schedule === "object" ? row.preferred_schedule : {},
    program: row.program_name ?? "",
    sessionType: SESSION_TYPE_LABEL_MAP[row.program_type] ?? "One-on-One",
    sessionsTotal: row.sessions_total ?? 0,
    sessionsUsed: row.sessions_used ?? 0,
    paid: Boolean(row.paid),
    purchaseDate: formatDate(row.purchase_date),
    expiryDate: formatDate(row.expiry_date),
    createdAt: row.created_at
  };
}

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
    latest_package.purchase_date,
    latest_package.expiry_date,
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

function isValidIsoDate(value) {
  if (!value || typeof value !== "string") return false;
  return !Number.isNaN(Date.parse(value));
}

function cleanString(value) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function makeValidationError(message) {
  const error = new Error(message);
  error.status = 400;
  error.name = "ValidationError";
  return error;
}

function isValidDaySlot(day, slot) {
  if (day === "Saturday") {
    return SATURDAY_TIME_SLOTS.has(slot);
  }
  return WEEKDAY_TIME_SLOTS.has(slot);
}

function normalizePreferredSchedule(inputDays, inputSchedule) {
  const preferredDays = [...new Set((Array.isArray(inputDays) ? inputDays : []).map((item) => cleanString(item)).filter(Boolean))];
  if (preferredDays.length === 0) {
    throw makeValidationError("Select at least one preferred training day");
  }
  if (!preferredDays.every((day) => VALID_WEEK_DAYS.has(day))) {
    throw makeValidationError("preferredDays contains an invalid day value");
  }

  const rawSchedule =
    inputSchedule && typeof inputSchedule === "object" && !Array.isArray(inputSchedule) ? inputSchedule : {};
  const preferredSchedule = {};

  for (const day of preferredDays) {
    const values = Array.isArray(rawSchedule[day]) ? rawSchedule[day] : [];
    const normalized = [...new Set(values.map((value) => cleanString(value)).filter(Boolean))];
    if (normalized.length === 0) {
      throw makeValidationError(`Select at least one preferred time for ${day}`);
    }
    if (!normalized.every((slot) => isValidDaySlot(day, slot))) {
      throw makeValidationError(
        day === "Saturday"
          ? "Saturday slots must be between 05:00 and 10:00"
          : `preferredSchedule contains an invalid time slot for ${day}`
      );
    }
    preferredSchedule[day] = normalized;
  }

  return { preferredDays, preferredSchedule };
}

router.get("/", async (req, res, next) => {
  try {
    const result = await query(`${CLIENT_SELECT_SQL} ORDER BY c.created_at DESC`);
    res.json(result.rows.map(toClientDto));
  } catch (error) {
    next(error);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({
        error: "ValidationError",
        message: "Client id must be a positive integer"
      });
    }

    const result = await query(`${CLIENT_SELECT_SQL} WHERE c.id = $1`, [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "NotFound",
        message: "Client not found"
      });
    }

    res.json(toClientDto(result.rows[0]));
  } catch (error) {
    next(error);
  }
});

router.post("/", async (req, res, next) => {
  const name = cleanString(req.body?.name);
  const phone = cleanString(req.body?.phone);
  const emailValue = cleanString(req.body?.email);
  const email = emailValue || null;
  const programInput = cleanString(req.body?.program);
  const programName = PROGRAM_ALIASES[programInput] ?? programInput;
  const sessionType = cleanString(req.body?.sessionType);
  const packageSize = Number(req.body?.packageSize);
  const purchaseDate = cleanString(req.body?.purchaseDate);
  const paid = Boolean(req.body?.paid);
  let preferredDays = [];
  let preferredSchedule = {};

  if (!name || !phone || !programName || !sessionType) {
    return res.status(400).json({
      error: "ValidationError",
      message: "name, phone, program, and sessionType are required"
    });
  }

  if (!VALID_PACKAGE_SIZES.has(packageSize)) {
    return res.status(400).json({
      error: "ValidationError",
      message: "packageSize must be one of: 1, 4, 8, 12, 16"
    });
  }

  if (!isValidIsoDate(purchaseDate)) {
    return res.status(400).json({
      error: "ValidationError",
      message: "purchaseDate must be a valid date"
    });
  }
  try {
    const normalized = normalizePreferredSchedule(req.body?.preferredDays, req.body?.preferredSchedule);
    preferredDays = normalized.preferredDays;
    preferredSchedule = normalized.preferredSchedule;
  } catch (error) {
    return res.status(error.status || 400).json({
      error: error.name || "ValidationError",
      message: error.message
    });
  }

  const programType = SESSION_TYPE_MAP[sessionType];
  if (!programType) {
    return res.status(400).json({
      error: "ValidationError",
      message: "sessionType must be One-on-One or Group"
    });
  }

  const dbClient = await pool.connect();
  try {
    await dbClient.query("BEGIN");

    const createdClient = await dbClient.query(
      `INSERT INTO clients (name, phone, email, preferred_days, preferred_schedule)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       RETURNING id`,
      [name, phone, email, preferredDays, JSON.stringify(preferredSchedule)]
    );
    const clientId = createdClient.rows[0].id;

    const programResult = await dbClient.query(
      `SELECT id
       FROM programs
       WHERE LOWER(name) = LOWER($1) AND type = $2
       LIMIT 1`,
      [programName, programType]
    );
    if (programResult.rows.length === 0) {
      throw makeValidationError("Selected program and session type are not valid");
    }
    const programId = programResult.rows[0].id;

    const priceResult = await dbClient.query(
      `SELECT price
       FROM package_pricing
       WHERE program_type = $1 AND sessions_total = $2
       LIMIT 1`,
      [programType, packageSize]
    );
    if (priceResult.rows.length === 0) {
      throw makeValidationError("No pricing configured for this package");
    }
    const price = priceResult.rows[0].price;

    await dbClient.query(
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
       VALUES ($1, $2, $3, 0, $4, $5, $6::date, ($6::date + INTERVAL '2 months')::date)`,
      [clientId, programId, packageSize, price, paid, purchaseDate]
    );

    const savedResult = await dbClient.query(`${CLIENT_SELECT_SQL} WHERE c.id = $1`, [clientId]);
    await dbClient.query("COMMIT");

    return res.status(201).json(toClientDto(savedResult.rows[0]));
  } catch (error) {
    await dbClient.query("ROLLBACK");
    if (error.code === "23505") {
      return res.status(409).json({
        error: "Conflict",
        message: "A client with that email already exists"
      });
    }
    return next(error);
  } finally {
    dbClient.release();
  }
});

router.patch("/:id/preferences", async (req, res, next) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({
        error: "ValidationError",
        message: "Client id must be a positive integer"
      });
    }

    const { preferredDays, preferredSchedule } = normalizePreferredSchedule(
      req.body?.preferredDays,
      req.body?.preferredSchedule
    );

    const updateResult = await query(
      `UPDATE clients
       SET preferred_days = $2, preferred_schedule = $3::jsonb
       WHERE id = $1
       RETURNING id`,
      [id, preferredDays, JSON.stringify(preferredSchedule)]
    );

    if (updateResult.rows.length === 0) {
      return res.status(404).json({
        error: "NotFound",
        message: "Client not found"
      });
    }

    const result = await query(`${CLIENT_SELECT_SQL} WHERE c.id = $1`, [id]);
    return res.json(toClientDto(result.rows[0]));
  } catch (error) {
    if (error.status === 400) {
      return res.status(400).json({
        error: error.name || "ValidationError",
        message: error.message
      });
    }
    return next(error);
  }
});

export default router;
