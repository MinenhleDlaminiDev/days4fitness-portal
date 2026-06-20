import { Link } from "react-router-dom";
import { useState } from "react";
import { LockKeyhole, Mail } from "lucide-react";
import GoogleAuthButton from "../components/GoogleAuthButton.jsx";
import ThemeToggle from "../components/ThemeToggle.jsx";
import { useAuth } from "../context/AuthContext.jsx";

export default function LoginPage() {
  const { error, login, loginWithGoogle } = useAuth();
  const [email, setEmail] = useState(import.meta.env.DEV ? "trainer@days4fitness.local" : "");
  const [password, setPassword] = useState(import.meta.env.DEV ? "ChangeMe123!" : "");
  const [isSaving, setIsSaving] = useState(false);
  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;

  async function submit(event) {
    event.preventDefault();
    setIsSaving(true);
    await login({ email, password });
    setIsSaving(false);
  }

  return (
    <main className="grid min-h-screen place-items-center bg-slate-100 p-4">
      <section className="w-full max-w-md overflow-hidden rounded-[2rem] border border-emerald-900/10 bg-white shadow-2xl">
        <header className="bg-gradient-to-br from-emerald-950 via-emerald-800 to-emerald-600 px-6 py-7 text-white">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-emerald-100">
                Trainer Portal
              </p>
              <h1 className="mt-2 text-3xl font-bold">Sign in</h1>
              <p className="mt-2 text-sm text-emerald-100">
                Access the Days4Fitness admin workspace.
              </p>
            </div>
            <ThemeToggle />
          </div>
        </header>

        <form onSubmit={submit} className="space-y-4 p-5 sm:p-6">
          <div className="space-y-3">
            {googleClientId ? (
              <GoogleAuthButton onCredential={loginWithGoogle} />
            ) : (
              <button
                type="button"
                disabled
                className="flex h-11 w-full items-center justify-center rounded-xl border border-slate-300 bg-slate-50 text-sm font-bold text-slate-400"
              >
                Sign in with Google
              </button>
            )}
            {!googleClientId && (
              <p className="text-center text-xs text-slate-500">
                Add VITE_GOOGLE_CLIENT_ID to enable Google sign-in.
              </p>
            )}
            <div className="flex items-center gap-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
              <span className="h-px flex-1 bg-slate-200" />
              Or
              <span className="h-px flex-1 bg-slate-200" />
            </div>
          </div>

          {!googleClientId && (
            <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-800">
              Google sign-in is ready in the code, but needs a Google OAuth client ID before it can be used.
            </p>
          )}

          <label className="block">
            <span className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              <Mail size={16} /> Email
            </span>
            <input
              required
              type="email"
              placeholder="trainer@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-2 h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-sm outline-none transition focus:border-emerald-700"
            />
          </label>

          <label className="block">
            <span className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              <LockKeyhole size={16} /> Password
            </span>
            <input
              required
              type="password"
              placeholder="Enter your password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-2 h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-sm outline-none transition focus:border-emerald-700"
            />
          </label>

          {error && (
            <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={isSaving}
            className="action-btn action-btn-primary w-full disabled:opacity-60"
          >
            {isSaving ? "Signing in..." : "Sign in"}
          </button>

          {import.meta.env.DEV && (
            <p className="text-center text-xs text-slate-500">
              Local default: trainer@days4fitness.local / ChangeMe123!
            </p>
          )}

          <p className="text-center text-sm text-slate-600">
            New trainer?{" "}
            <Link to="/signup" className="font-bold text-emerald-700 hover:text-emerald-800">
              Create an account
            </Link>
          </p>
        </form>
      </section>
    </main>
  );
}
