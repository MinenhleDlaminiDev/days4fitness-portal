import { useState } from "react";
import { Moon, Sun } from "lucide-react";

const THEME_STORAGE_KEY = "days4fitness-theme";

// index.html sets data-theme before first paint, so read that rather than
// defaulting to light and correcting in an effect (which flashed on every load).
function currentTheme() {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  document.documentElement.classList.toggle("dark", theme === "dark");
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState(currentTheme);

  function toggleTheme() {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    applyTheme(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Private browsing or blocked storage: the theme still applies for this visit.
    }
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
