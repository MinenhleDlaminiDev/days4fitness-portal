// A dumbbell whose crossbar and stem form a 4. Drawn in currentColor, so one
// copy serves the green header, a light surface and dark mode — the caller
// sets the colour by setting text colour.
//
// The artboard is 88 wide by 72 tall. The stem sits at the centre so the bar
// shows equally either side of it; moving any one of the plates, the bar or
// the stem means re-checking that balance.
const VIEW_BOX = "0 0 88 72";

export function LogoMark({ size = 24, className = "", title }) {
  return (
    <svg
      viewBox={VIEW_BOX}
      height={size}
      width={(size * 88) / 72}
      className={className}
      fill="currentColor"
      stroke="currentColor"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : "true"}
      focusable="false"
    >
      {title && <title>{title}</title>}
      <rect x="6" y="35" width="7" height="22" rx="3" />
      <rect x="75" y="35" width="7" height="22" rx="3" />
      <rect x="15" y="28" width="10" height="36" rx="4" />
      <rect x="63" y="28" width="10" height="36" rx="4" />
      <rect x="20" y="42" width="48" height="8" rx="4" />
      <path d="M44 10 L25 42" strokeWidth="8" fill="none" strokeLinecap="round" />
      <rect x="40" y="6" width="8" height="62" rx="4" />
    </svg>
  );
}

/**
 * The wordmark with the mark standing in for the numeral. The words are real
 * text rather than paths inside the SVG, so they use the app's own font and
 * scale with it. The whole thing carries one accessible name, because
 * "DAYS" + icon + "FITNESS" would otherwise be read out as two words.
 */
export function LogoLockup({ size = 28, className = "" }) {
  return (
    <span
      role="img"
      aria-label="Days4Fitness"
      className={`inline-flex items-baseline font-bold tracking-[0.08em] ${className}`}
      style={{ fontSize: size }}
    >
      <span aria-hidden="true">DAYS</span>
      {/* Lifted off the baseline so the stem's foot sits on it, like a numeral. */}
      <LogoMark size={size * 1.25} className="mx-[0.2em] translate-y-[0.08em]" />
      <span aria-hidden="true">FITNESS</span>
    </span>
  );
}
