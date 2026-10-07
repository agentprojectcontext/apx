import "@apx/ui/styles.css";
import "./app.css";
import "./styles/inbox.css";
import "./styles/chat.css";
import "./styles/side-panel.css";
import "./styles/documents.css";
import "./styles/chat-tools.css";
import "./styles/composer.css";
import "./styles/inbox-views.css";
import "./styles/quick.css";
import "./styles/nav.css";
import "./styles/topbar.css";
import "./styles/setup.css";
import "./styles/project.css";
import "./styles/team.css";
import "./styles/resources.css";
import "./styles/tasks.css";
import "./styles/channels.css";
import "./styles/office.css";
import "./styles/files.css";
import "./styles/config.css";
import "./styles/models.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { prefs } from "./data/prefs.ts";
import { isLanguage, startI18n } from "./i18n/index.ts";

// A newer panel replaced this page's lazy parts (an update, a rebuild): load it again instead of a blank screen. Not
// twice in a few seconds: a panel that keeps failing shows its error.
window.addEventListener("vite:preloadError", (e) => {
  const key = "apx.preloadReload";
  try {
    if (Date.now() - Number(sessionStorage.getItem(key) ?? 0) < 10_000) return;
    sessionStorage.setItem(key, String(Date.now()));
  } catch {
    return;
  }
  e.preventDefault();
  window.location.reload();
});

// The desktop's About window is on another origin than the panel: the shell passes the panel's language along.
const lang = new URLSearchParams(window.location.search).get("lang");
if (isLanguage(lang)) prefs.set({ language: lang });

const root = document.getElementById("root");
if (!root) throw new Error("#root missing");
// The language's texts arrive first (one small chunk): the panel never flashes keys or another language.
void startI18n().then(() =>
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  ),
);
