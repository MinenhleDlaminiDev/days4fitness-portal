import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

const THEME_STORAGE_KEY = "days4fitness-theme";

function resolveInitialTheme() {
  const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  document.documentElement.classList.toggle("dark", theme === "dark");
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState("light");

  useEffect(() => {
    const initial = resolveInitialTheme();
    setTheme(initial);
    applyTheme(initial);
  }, []);

  function toggleTheme() {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    applyTheme(next);
    window.localStorage.setItem(THEME_STORAGE_KEY, next);
  }

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className={`theme-toggle ${theme === "dark" ? "dark" : ""}`}
      aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
      title={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
    >
      <span className="theme-toggle-knob">
        {theme === "light" ? <Sun size={14} className="stroke-[2]" /> : <Moon size={14} className="stroke-[2]" />}
      </span>
    </button>
  );
}
