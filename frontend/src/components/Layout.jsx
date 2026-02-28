import { Outlet } from "react-router-dom";
import BottomNav from "./BottomNav.jsx";

export default function Layout() {
  return (
    <div className="min-h-screen bg-[#f1f3f5] text-slate-900">
      <main className="mx-auto max-w-6xl pb-20">
        <Outlet />
      </main>
      <BottomNav />
    </div>
  );
}
