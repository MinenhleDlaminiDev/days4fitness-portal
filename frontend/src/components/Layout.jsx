import { Outlet } from "react-router-dom";
import TopNav from "./TopNav.jsx";

export default function Layout() {
  return (
    <div className="app-shell">
      <TopNav />
      <main className="mx-auto max-w-6xl">
        <Outlet />
      </main>
    </div>
  );
}
