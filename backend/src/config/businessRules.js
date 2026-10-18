// Pure mappings only. The rules the trainer owns — package sizes, business
// hours, group capacity, session length and the package expiry window — moved
// into the database in migration 017 and are served from settingsCache.js.

export const SESSION_TYPES = [
  { value: "One-on-One", databaseValue: "one_on_one" },
  { value: "Group", databaseValue: "group" }
];

export const PROGRAM_ALIASES = {
  "Toning and Shaping": "Toning & Shaping"
};

export function sessionTypeToDatabase(value) {
  return SESSION_TYPES.find((item) => item.value === value)?.databaseValue;
}

export function sessionTypeFromDatabase(value) {
  return SESSION_TYPES.find((item) => item.databaseValue === value)?.value;
}
