import { Link } from "react-router-dom";
import { useState } from "react";
import { LockKeyhole, Mail, User } from "lucide-react";
import GoogleAuthButton from "../components/GoogleAuthButton.jsx";
import ThemeToggle from "../components/ThemeToggle.jsx";
import { LogoLockup } from "../components/Logo.jsx";
import { useAuth } from "../context/AuthContext.jsx";

// AUTH-07. Kept in step with PASSWORD_MIN_LENGTH in auth.service.js. The rule
// is shown before anything is submitted rather than only after a rejection,
// so the server check is the backstop and not the first the person hears of it.
const PASSWORD_MIN_LENGTH = 10;

function passwordProblem(password) {
  if (!password) return "";
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `At least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return "Needs a letter and a number.";
  }
  return "";
}

export default function SignupPage() {
  const { error, signup, signupWithGoogle } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;

  const problem = passwordProblem(password);
  const canSubmit = Boolean(email) && Boolean(password) && !problem;

  async function submit(event) {
    event.preventDefault();
    if (!canSubmit) return;
    setIsSaving(true);
    await signup({ name, email, password });
    setIsSaving(false);
  }

  return (
    <main className="grid min-h-screen place-items-center bg-sunken p-4">
      <section className="w-full max-w-md overflow-hidden rounded-[2rem] border border-emerald-900/10 bg-surface shadow-2xl">
        <header className="bg-gradient-to-br from-emerald-950 via-emerald-800 to-emerald-600 px-6 py-7 text-white">
          <div className="flex items-start justify-between gap-3">
            <div>
              <LogoLockup size={19} className="text-white" />
              <h1 className="mt-2 text-3xl font-bold">Set up account</h1>
              <p className="mt-2 text-sm text-emerald-100">
                Trainer access is by invitation. Use the email address an admin
                has approved.
              </p>
            </div>
            <ThemeToggle />
          </div>
        </header>

        <form onSubmit={submit} className="space-y-4 p-5 sm:p-6">
          <div className="space-y-3">
            {googleClientId ? (
              <GoogleAuthButton label="signup_with" onCredential={signupWithGoogle} />
            ) : (
              <p className="rounded-xl border border-warn-border bg-warn-soft p-3 text-sm font-semibold text-warn-text">
                Google sign-up is not configured yet. Add VITE_GOOGLE_CLIENT_ID to enable it.
              </p>
            )}
            <div className="flex items-center gap-3 text-xs font-semibold uppercase tracking-wide text-faint">
              <span className="h-px flex-1 bg-line" />
              Or
              <span className="h-px flex-1 bg-line" />
            </div>
          </div>

          <label className="block">
            <span className="flex items-center gap-2 text-sm font-semibold text-copy">
              <User size={16} /> Name
            </span>
            <input
              type="text"
              placeholder="How your name should appear"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="mt-2 h-12 w-full rounded-xl border border-line-strong bg-surface px-4 text-sm outline-none transition focus:border-accent"
            />
          </label>

          <label className="block">
            <span className="flex items-center gap-2 text-sm font-semibold text-copy">
              <Mail size={16} /> Email
            </span>
            <input
              required
              type="email"
              placeholder="trainer@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-2 h-12 w-full rounded-xl border border-line-strong bg-surface px-4 text-sm outline-none transition focus:border-accent"
            />
          </label>

          <label className="block">
            <span className="flex items-center gap-2 text-sm font-semibold text-copy">
              <LockKeyhole size={16} /> Password
            </span>
            <input
              required
              type="password"
              placeholder={`At least ${PASSWORD_MIN_LENGTH} characters`}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-2 h-12 w-full rounded-xl border border-line-strong bg-surface px-4 text-sm outline-none transition focus:border-accent"
            />
            <span className={`mt-2 block text-xs ${problem ? "font-semibold text-warn-text" : "text-subtle"}`}>
              {problem || `At least ${PASSWORD_MIN_LENGTH} characters, including a letter and a number.`}
            </span>
          </label>

          {error && (
            <p className="rounded-xl border border-danger-border bg-danger-soft p-3 text-sm font-semibold text-danger-strong">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={isSaving || !canSubmit}
            className="action-btn action-btn-primary w-full disabled:opacity-60"
          >
            {isSaving ? "Creating account..." : "Create account"}
          </button>

          <p className="text-center text-sm text-muted">
            Already have an account?{" "}
            <Link to="/login" className="font-bold text-accent hover:text-accent">
              Sign in
            </Link>
          </p>
        </form>
      </section>
    </main>
  );
}
