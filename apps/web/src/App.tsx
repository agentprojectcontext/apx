import { ApxProvider } from "@apx/ui";
import { type CSSProperties, useEffect } from "react";
import { startLive } from "./data/live.ts";
import { usePrefs } from "./data/prefs.ts";
import { useNav } from "./shell/nav.ts";
import { Shell } from "./shell/Shell.tsx";

// Config › Apariencia › Fuente: swapping the sans token reaches every component, overlays included.
const MONO = { "--apx-font-sans": "var(--apx-font-mono)" } as CSSProperties;

export function App() {
  const mode = useNav((s) => s.mode);
  const look = usePrefs((s) => s.look);
  const font = usePrefs((s) => s.font);
  useEffect(() => startLive(), []);
  return (
    <ApxProvider look={look} mode={mode} fill style={font === "mono" ? MONO : undefined}>
      <Shell />
    </ApxProvider>
  );
}
