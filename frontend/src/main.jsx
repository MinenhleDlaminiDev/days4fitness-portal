import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import { AppConfigurationProvider } from "./context/AppConfigurationContext.jsx";
import { AuthProvider } from "./context/AuthContext.jsx";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AuthProvider>
        <AppConfigurationProvider>
          <App />
        </AppConfigurationProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
