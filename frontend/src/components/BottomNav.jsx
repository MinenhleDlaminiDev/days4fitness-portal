import { NavLink } from "react-router-dom";
import { Calendar as CalendarIcon, Clock as ClockIcon, Users as UsersIcon } from "lucide-react";

const items = [
  { to: "/", label: "Dashboard", icon: CalendarIcon },
  { to: "/schedule", label: "Schedule", icon: ClockIcon },
  { to: "/clients", label: "Clients", icon: UsersIcon }
];

export default function BottomNav() {
  return (
    <nav className="app-nav fixed bottom-0 left-0 right-0 z-40 border-t backdrop-blur">
      <div className="mx-auto flex max-w-6xl">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `app-nav-link flex flex-1 flex-col items-center gap-1 py-3 text-xs font-medium transition ${
                  isActive ? "text-emerald-700" : "text-slate-500 hover:text-slate-700"
                }`
              }
            >
              <Icon size={20} className="stroke-[1.75]" />
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}
