import { Link } from "react-router-dom";
import GoogleAuthButton from "../components/GoogleAuthButton.jsx";
import ThemeToggle from "../components/ThemeToggle.jsx";
import { LogoLockup } from "../components/Logo.jsx";
import { useAuth } from "../context/AuthContext.jsx";

export default function SignupPage() {
  const { error, signupWithGoogle } = useAuth();
  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;

  return (
    <main className="grid min-h-screen place-items-center bg-sunken p-4">
      <section className="w-full max-w-md overflow-hidden rounded-[2rem] border border-emerald-900/10 bg-surface shadow-2xl">
        <header className="bg-gradient-to-br from-emerald-950 via-emerald-800 to-emerald-600 px-6 py-7 text-white">
          <div className="flex items-start justify-between gap-3">
            <div>
              <LogoLockup size={19} className="text-white" />
              <h1 className="mt-2 text-3xl font-bold">Set up account</h1>
              <p className="mt-2 text-sm text-emerald-100">
                Trainer access is by invitation. Sign in with the Gmail address an
                admin has approved.
              </p>
            </div>
            <ThemeToggle />
          </div>
        </header>

        <div className="space-y-4 p-5 sm:p-6">
          {googleClientId ? (
            <GoogleAuthButton label="signup_with" onCredential={signupWithGoogle} />
          ) : (
            <p className="rounded-xl border border-warn-border bg-warn-soft p-3 text-sm font-semibold text-warn-text">
              Google sign-up is not configured yet. Add VITE_GOOGLE_CLIENT_ID to enable it.
            </p>
          )}

          {error && (
            <p className="rounded-xl border border-danger-border bg-danger-soft p-3 text-sm font-semibold text-danger-strong">
              {error}
            </p>
          )}

          <div className="rounded-2xl border border-line bg-raised p-4 text-sm text-muted">
            For testing and pre-live access, any verified Gmail account can create a trainer profile.
            We will replace this with an approval process later.
          </div>

          <p className="text-center text-sm text-muted">
            Already have an account?{" "}
            <Link to="/login" className="font-bold text-accent hover:text-accent">
              Sign in
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}
