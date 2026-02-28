export function daysUntil(dateStr) {
  const now = new Date();
  const target = new Date(dateStr);
  const diffMs = target.setHours(0, 0, 0, 0) - now.setHours(0, 0, 0, 0);
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

export function formatShortDate(dateStr) {
  return new Date(dateStr).toLocaleDateString("en-ZA", {
    month: "numeric",
    day: "numeric",
    year: "numeric"
  });
}

export function addTwoMonths(dateStr) {
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + 2);
  return d.toISOString().slice(0, 10);
}

