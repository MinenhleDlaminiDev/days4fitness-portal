import { NavLink } from "react-router-dom";
import { CalendarIcon, ClockIcon, UsersIcon } from "./Icons.jsx";

const items = [
  { to: "/", label: "Dashboard", icon: CalendarIcon },
  { to: "/schedule", label: "Schedule", icon: ClockIcon },
  { to: "/clients", label: "Clients", icon: UsersIcon }
];

export default function BottomNav() {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-slate-200/80 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex flex-1 flex-col items-center gap-1 py-3 text-xs font-medium transition ${
                  isActive ? "text-emerald-700" : "text-slate-500 hover:text-slate-700"
                }`
              }
            >
              <Icon size={22} />
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}
