import { ApxProvider } from "@apx/ui";
import { type CSSProperties, lazy, Suspense, useEffect } from "react";
import { startLive } from "./data/live.ts";
import { usePrefs } from "./data/prefs.ts";
import { loadSetup, useSetup } from "./data/setup.ts";
import { useLanguage } from "./i18n/index.ts";
import { QuickChat } from "./quick/QuickChat.tsx";
import { useNav } from "./shell/nav.ts";
import { Shell } from "./shell/Shell.tsx";

const Wizard = lazy(() => import("./setup/Wizard.tsx").then((m) => ({ default: m.Wizard })));

/** The desktop app's menu-bar window loads the panel with ?quick: only the quick chat. */
const QUICK = new URLSearchParams(window.location.search).has("quick");

// Settings › Appearance › Font: swapping the sans token reaches every component, overlays included.
const MONO = { "--apx-font-sans": "var(--apx-font-mono)" } as CSSProperties;

export function App() {
  const mode = useNav((s) => s.mode);
  const look = usePrefs((s) => s.look);
  const font = usePrefs((s) => s.font);
  const lang = useLanguage();
  const setup = useSetup((s) => s.open);
  useEffect(() => startLive(), []);
  useEffect(() => {
    if (!QUICK) void loadSetup();
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  return (
    <ApxProvider look={look} mode={mode} fill style={font === "mono" ? MONO : undefined}>
      {QUICK ? <QuickChat /> : <Shell />}
      {!QUICK && setup && (
        <Suspense fallback={null}>
          <Wizard />
        </Suspense>
      )}
    </ApxProvider>
  );
}
