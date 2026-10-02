import "@apx/ui/styles.css";
import "./app.css";
import "./styles/inbox.css";
import "./styles/chat.css";
import "./styles/side-panel.css";
import "./styles/chat-tools.css";
import "./styles/inbox-views.css";
import "./styles/quick.css";
import "./styles/nav.css";
import "./styles/project.css";
import "./styles/office.css";
import "./styles/config.css";
import "./styles/models.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";

const root = document.getElementById("root");
if (!root) throw new Error("#root missing");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
