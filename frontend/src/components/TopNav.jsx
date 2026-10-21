import { useEffect, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  Calendar as CalendarIcon,
  ClipboardCheck as ClipboardCheckIcon,
  BarChart3 as ReportsIcon,
  Clock as ClockIcon,
  LogOut,
  Menu as MenuIcon,
  Settings as SettingsIcon,
  Users as UsersIcon,
  X as CloseIcon
} from "lucide-react";
import ThemeToggle from "./ThemeToggle.jsx";
import { useAuth } from "../context/AuthContext.jsx";

const items = [
  { to: "/", label: "Dashboard", icon: CalendarIcon },
  { to: "/schedule", label: "Schedule", icon: ClockIcon },
  { to: "/clients", label: "Clients", icon: UsersIcon },
  { to: "/requests", label: "Approvals", icon: ClipboardCheckIcon },
  { to: "/reports", label: "Reports", icon: ReportsIcon },
  { to: "/settings", label: "Settings", icon: SettingsIcon }
];

const MENU_ID = "primary-nav-menu";

export default function TopNav() {
  const { logout, trainer } = useAuth();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const barRef = useRef(null);
  const { pathname } = useLocation();

  // Navigating is the most common way the menu should close, and a NavLink
  // inside it does not tell us it was tapped.
  useEffect(() => {
    setIsMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!isMenuOpen) return undefined;

    function onKeyDown(event) {
      if (event.key === "Escape") setIsMenuOpen(false);
    }
    // pointerdown rather than click: a tap that starts outside should dismiss
    // even if it lands on something that stops the click.
    function onPointerDown(event) {
      if (!barRef.current?.contains(event.target)) setIsMenuOpen(false);
    }

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [isMenuOpen]);

  return (
    <header ref={barRef} className="app-nav sticky top-0 z-40 border-b backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2 sm:px-6">
        {/* The links only fit beside the controls from md up; below that they
            live in the menu instead. */}
        <nav className="hidden items-center gap-1 md:flex">
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `app-nav-link inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition ${
                    isActive ? "bg-brand-tint text-accent" : "text-subtle hover:text-copy"
                  }`
                }
              >
                <Icon size={18} className="stroke-[1.75]" />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        {/* ml-auto, not justify-between: below md the links are display:none,
            so there is no left-hand item to push these to the right. */}
        <div className="ml-auto flex items-center gap-3">
          <ThemeToggle />
          <span className="hidden h-[30px] items-center rounded-full border border-success-border bg-surface/80 px-3 text-xs font-semibold text-accent md:inline-flex">
            {trainer?.name}
          </span>
          <button
            type="button"
            onClick={logout}
            className="sign-out-btn hidden h-[30px] items-center rounded-full border px-3 text-xs font-bold shadow-sm transition md:inline-flex"
          >
            Sign out
          </button>
          <button
            type="button"
            onClick={() => setIsMenuOpen((open) => !open)}
            aria-expanded={isMenuOpen}
            aria-controls={MENU_ID}
            aria-label={isMenuOpen ? "Close main menu" : "Open main menu"}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-copy md:hidden"
          >
            {isMenuOpen ? (
              <CloseIcon size={20} className="stroke-[1.75]" />
            ) : (
              <MenuIcon size={20} className="stroke-[1.75]" />
            )}
          </button>
        </div>
      </div>

      {/* Rendered only while open rather than hidden with a class, so nothing
          in it is reachable by keyboard behind a closed menu. */}
      {isMenuOpen && (
        <div id={MENU_ID} className="border-t border-line px-4 pb-3 pt-2 md:hidden">
          <nav className="flex flex-col">
            {items.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    `app-nav-link flex h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium transition ${
                      isActive ? "bg-brand-tint text-accent" : "text-copy"
                    }`
                  }
                >
                  <Icon size={18} className="stroke-[1.75]" />
                  <span>{item.label}</span>
                </NavLink>
              );
            })}
          </nav>
          <div className="mt-2 flex items-center justify-between gap-3 border-t border-line pt-3">
            <span className="truncate text-xs font-semibold text-accent">{trainer?.name}</span>
            <button
              type="button"
              onClick={logout}
              className="sign-out-btn inline-flex h-11 shrink-0 items-center rounded-xl border px-4 text-xs font-bold transition"
            >
              <LogOut size={15} className="mr-2 stroke-[1.75]" />
              Sign out
            </button>
          </div>
        </div>
      )}
    </header>
  );
}
