// UX-03. Counts followed by a hardcoded "sessions" read "1 sessions" for a
// one-session package. The conditional was already written out inline in three
// places and needed in six more, so it lives here once instead.

/**
 * The right form of a word for `count`.
 *
 * Returns the word alone rather than "N word", so a call site keeps control of
 * what sits around it: "1 Session - One-on-One", "0 of 1 session used",
 * "2 sessions left". Pass `plural` when it is not just the singular plus s.
 *
 * @example `${n} ${pluralise(n, "session")} remaining`
 * @example `${n} ${pluralise(n, "Session")}`
 * @example pluralise(n, "class", "classes")
 */
export function pluralise(count, singular, plural = `${singular}s`) {
  return Number(count) === 1 ? singular : plural;
}
