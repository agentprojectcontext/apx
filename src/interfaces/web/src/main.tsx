import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./styles.css";
import { App } from "./App";
import { ThemeProvider } from "./hooks/useTheme";
import { registerServiceWorker } from "./lib/pwa";
import { startAgentNotifications } from "./lib/notify";

// The shared model catalog (GET /engines/presets) is hydrated by
// useTokenBootstrap once the bearer token is known good — it is an
// authenticated endpoint, so it cannot be fetched this early.

// Installing the panel to a phone's home screen needs a service worker that
// handles fetch — that is Chrome's rule, not ours. It also needs a secure
// context, which http:// on a LAN address is not; see lib/pwa.
registerServiceWorker();

// Agent notifications resume on their own if they were ever switched on: the
// permission belongs to the browser and the preference to this device, so a
// reload should not be a second decision. No-op when either says no.
startAgentNotifications();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>
);
