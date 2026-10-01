import "@apx/ui/styles.css";
import "./app.css";
import "./styles/nav.css";
import "./styles/project.css";
import "./styles/config.css";
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
