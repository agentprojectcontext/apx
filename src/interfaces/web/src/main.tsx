import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./styles.css";
import { App } from "./App";
import { ThemeProvider } from "./hooks/useTheme";

// The shared model catalog (GET /engines/presets) is hydrated by
// useTokenBootstrap once the bearer token is known good — it is an
// authenticated endpoint, so it cannot be fetched this early.

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>
);
