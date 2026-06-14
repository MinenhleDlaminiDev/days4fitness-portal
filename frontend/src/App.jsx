import { Navigate, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout.jsx";
import DashboardPage from "./pages/DashboardPage.jsx";
import SchedulePage from "./pages/SchedulePage.jsx";
import ClientsPage from "./pages/ClientsPage.jsx";
import ClientProfilePage from "./pages/ClientProfilePage.jsx";
import ClientFormPage from "./pages/ClientFormPage.jsx";
import NotFoundPage from "./pages/NotFoundPage.jsx";
import { useAppConfiguration } from "./context/AppConfigurationContext.jsx";

export default function App() {
  const { error, isLoading, reload } = useAppConfiguration();

  if (isLoading) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-100 p-4">
        <div className="surface-card w-full max-w-md text-center text-sm text-slate-600">
          Loading application configuration...
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-100 p-4">
        <div className="surface-card w-full max-w-md text-center">
          <h1 className="text-xl font-semibold text-slate-900">Unable to start the application</h1>
          <p className="mt-2 text-sm text-red-700">{error}</p>
          <button type="button" onClick={reload} className="action-btn action-btn-primary mt-4 w-full">
            Try Again
          </button>
        </div>
      </main>
    );
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/schedule" element={<SchedulePage />} />
        <Route path="/clients" element={<ClientsPage />} />
        <Route path="/clients/new" element={<ClientFormPage />} />
        <Route path="/clients/:id" element={<ClientProfilePage />} />
        <Route path="/clients/:id/edit" element={<ClientFormPage />} />
        <Route path="/dashboard" element={<Navigate to="/" replace />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
