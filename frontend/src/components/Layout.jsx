import { Outlet } from "react-router-dom";
import BottomNav from "./BottomNav.jsx";
import { useAuth } from "../context/AuthContext.jsx";

export default function Layout() {
  const { logout, trainer } = useAuth();

  return (
    <div className="app-shell">
      <div className="mx-auto flex max-w-6xl items-center justify-end gap-3 px-4 pt-4 sm:px-6">
        <span className="hidden rounded-full border border-emerald-200 bg-white/80 px-3 py-1 text-xs font-semibold text-emerald-800 sm:inline-flex">
          {trainer?.name}
        </span>
        <button
          type="button"
          onClick={logout}
          className="sign-out-btn rounded-full border px-3 py-1.5 text-xs font-bold shadow-sm transition"
        >
          Sign out
        </button>
      </div>
      <main className="mx-auto max-w-6xl pb-20">
        <Outlet />
      </main>
      <BottomNav />
    </div>
  );
}
