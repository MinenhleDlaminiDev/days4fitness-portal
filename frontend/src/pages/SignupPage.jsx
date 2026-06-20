import { Link } from "react-router-dom";
import GoogleAuthButton from "../components/GoogleAuthButton.jsx";
import ThemeToggle from "../components/ThemeToggle.jsx";
import { useAuth } from "../context/AuthContext.jsx";

export default function SignupPage() {
  const { error, signupWithGoogle } = useAuth();
  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;

  return (
    <main className="grid min-h-screen place-items-center bg-slate-100 p-4">
      <section className="w-full max-w-md overflow-hidden rounded-[2rem] border border-emerald-900/10 bg-white shadow-2xl">
        <header className="bg-gradient-to-br from-emerald-950 via-emerald-800 to-emerald-600 px-6 py-7 text-white">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-emerald-100">
                Trainer Portal
              </p>
              <h1 className="mt-2 text-3xl font-bold">Create account</h1>
              <p className="mt-2 text-sm text-emerald-100">
                Use a Gmail account to join the pre-live trainer workspace.
              </p>
            </div>
            <ThemeToggle />
          </div>
        </header>

        <div className="space-y-4 p-5 sm:p-6">
          {googleClientId ? (
            <GoogleAuthButton label="signup_with" onCredential={signupWithGoogle} />
          ) : (
            <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-800">
              Google sign-up is not configured yet. Add VITE_GOOGLE_CLIENT_ID to enable it.
            </p>
          )}

          {error && (
            <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">
              {error}
            </p>
          )}

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
            For testing and pre-live access, any verified Gmail account can create a trainer profile.
            We will replace this with an approval process later.
          </div>

          <p className="text-center text-sm text-slate-600">
            Already have an account?{" "}
            <Link to="/login" className="font-bold text-emerald-700 hover:text-emerald-800">
              Sign in
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}
