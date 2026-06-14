export const SESSION_TYPES = [
  { value: "One-on-One", databaseValue: "one_on_one" },
  { value: "Group", databaseValue: "group" }
];

export const PACKAGE_SIZES = [1, 4, 8, 12, 16];
export const GROUP_CAPACITY = 8;
export const SESSION_DURATION_MINUTES = 60;
export const PACKAGE_EXPIRY_MONTHS = 2;

const weekdaySlots = Array.from(
  { length: 15 },
  (_, index) => `${String(index + 5).padStart(2, "0")}:00`
);
const saturdaySlots = Array.from(
  { length: 6 },
  (_, index) => `${String(index + 5).padStart(2, "0")}:00`
);

export const BUSINESS_HOURS = [
  { day: "Monday", timeSlots: weekdaySlots },
  { day: "Tuesday", timeSlots: weekdaySlots },
  { day: "Wednesday", timeSlots: weekdaySlots },
  { day: "Thursday", timeSlots: weekdaySlots },
  { day: "Friday", timeSlots: weekdaySlots },
  { day: "Saturday", timeSlots: saturdaySlots }
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

export function timeSlotsForDay(day) {
  return BUSINESS_HOURS.find((item) => item.day === day)?.timeSlots || [];
}
