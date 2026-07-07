import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./styles.css";
import { App } from "./App";
import { ThemeProvider } from "./hooks/useTheme";
import { loadEnginePresets } from "./components/settings/providers/typeStyles";

// Hydrate the shared model catalog (GET /engines/presets) in the background so
// provider forms show up-to-date model lists. Non-blocking: app renders anyway.
void loadEnginePresets();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>
);
