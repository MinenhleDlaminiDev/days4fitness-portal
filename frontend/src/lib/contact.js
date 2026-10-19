// Pre-filled contact links for the trainer's own WhatsApp, SMS and mail apps.
// Nothing here sends anything: every link opens a draft the trainer reads,
// edits and sends themselves.

// The studio is South African and clients are captured with local numbers, so
// a leading 0 is expanded to +27. wa.me refuses anything that is not in
// international format.
const DEFAULT_COUNTRY_CODE = "27";

// Shortest number worth offering a link for. Below this the stored value is a
// typo or a placeholder, and the link would open an app on nothing.
const MIN_DIGITS = 9;

function digitsOnly(value) {
  return String(value ?? "").replace(/\D/g, "");
}

// "082 555 0700" -> "27825550700". Returns "" when the number is unusable, so
// callers can hide the action rather than render a broken link.
export function internationalDigits(phone) {
  const raw = String(phone ?? "").trim();
  if (!raw) return "";

  let digits = digitsOnly(raw);
  if (digits.length === 0) return "";

  if (raw.startsWith("+")) {
    // Already international; the + is dropped because wa.me omits it.
  } else if (digits.startsWith("00")) {
    digits = digits.slice(2);
  } else if (digits.startsWith("0")) {
    digits = `${DEFAULT_COUNTRY_CODE}${digits.slice(1)}`;
  } else if (!digits.startsWith(DEFAULT_COUNTRY_CODE)) {
    digits = `${DEFAULT_COUNTRY_CODE}${digits}`;
  }

  return digits.length >= MIN_DIGITS ? digits : "";
}

export function whatsappHref(phone, message) {
  const digits = internationalDigits(phone);
  if (!digits) return "";
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

export function smsHref(phone, message) {
  const digits = internationalDigits(phone);
  if (!digits) return "";
  // `?body=` is the Android form; iOS accepts it too on current versions.
  return `sms:+${digits}?body=${encodeURIComponent(message)}`;
}

export function mailHref(email, subject, message) {
  const address = String(email ?? "").trim();
  if (!address) return "";
  // The address itself is left as stored: encoding the @ makes some mail
  // clients open a draft addressed to nobody.
  return `mailto:${address}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(
    message
  )}`;
}

// One place that decides which of the three actions a client can receive.
// An action is absent when the detail behind it is missing, never disabled.
export function contactActions({ phone, email }, { subject, message }) {
  return [
    { key: "whatsapp", label: "WhatsApp", href: whatsappHref(phone, message) },
    { key: "sms", label: "SMS", href: smsHref(phone, message) },
    { key: "email", label: "Email", href: mailHref(email, subject, message) }
  ].filter((action) => action.href);
}

function firstName(clientName) {
  return String(clientName ?? "").trim().split(/\s+/)[0] || "there";
}

function money(value) {
  return `R${Number(value || 0).toFixed(2)}`;
}

export function outstandingPaymentMessage(clientName, outstandingBalance, program) {
  return (
    `Hi ${firstName(clientName)}, just a reminder that ${money(outstandingBalance)} ` +
    `is still outstanding on your ${program} package. Let me know if you need the ` +
    `banking details. Thanks!`
  );
}

export function expiringPackageMessage(clientName, sessionsRemaining, expiryDate) {
  const sessions = `${sessionsRemaining} session${sessionsRemaining === 1 ? "" : "s"}`;
  return (
    `Hi ${firstName(clientName)}, you still have ${sessions} left and your package ` +
    `expires on ${expiryDate}. Shall we get them booked in?`
  );
}

export function generalMessage(clientName) {
  return `Hi ${firstName(clientName)}, `;
}

export const CONTACT_SUBJECTS = {
  outstanding: "Outstanding payment",
  expiring: "Your package is expiring",
  general: "Days4Fitness"
};
