import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import { AppConfigurationProvider } from "./context/AppConfigurationContext.jsx";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <AppConfigurationProvider>
        <App />
      </AppConfigurationProvider>
    </BrowserRouter>
  </React.StrictMode>
);
