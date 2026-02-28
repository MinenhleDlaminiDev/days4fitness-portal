import { NavLink } from "react-router-dom";
import { CalendarIcon, ClockIcon, UsersIcon } from "./Icons.jsx";

const items = [
  { to: "/", label: "Dashboard", icon: CalendarIcon },
  { to: "/schedule", label: "Schedule", icon: ClockIcon },
  { to: "/clients", label: "Clients", icon: UsersIcon }
];

export default function BottomNav() {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex flex-1 flex-col items-center gap-1 py-3 text-xs font-medium ${
                  isActive ? "text-[#2f66e0]" : "text-slate-400"
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

