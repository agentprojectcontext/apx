import { ApxProvider } from "@apx/ui";
import { type CSSProperties, lazy, Suspense, useEffect } from "react";
import { startLive } from "./data/live.ts";
import { checkAccess, useGate } from "./data/pairing.ts";
import { usePrefs } from "./data/prefs.ts";
import { loadSetup, useSetup } from "./data/setup.ts";
import { useLanguage } from "./i18n/index.ts";
import { QuickChat } from "./quick/QuickChat.tsx";
import { useNav } from "./shell/nav.ts";
import { Shell } from "./shell/Shell.tsx";

const Wizard = lazy(() => import("./setup/Wizard.tsx").then((m) => ({ default: m.Wizard })));
const PairScreen = lazy(() => import("./setup/PairScreen.tsx").then((m) => ({ default: m.PairScreen })));
const ConnectScreen = lazy(() => import("./setup/ConnectScreen.tsx").then((m) => ({ default: m.ConnectScreen })));

/** The desktop app's menu-bar window loads the panel with ?quick: only the quick chat. */
const QUICK = new URLSearchParams(window.location.search).has("quick");

// Settings › Appearance › Font: swapping the sans token reaches every component, overlays included.
const MONO = { "--apx-font-sans": "var(--apx-font-mono)" } as CSSProperties;

/** The desktop app's first run (?connect): no APX is chosen yet, so nothing calls a core. */
const CONNECT = new URLSearchParams(window.location.search).has("connect") && Boolean(window.apxConnect);

export function App() {
  if (CONNECT)
    return (
      <ApxProvider look="minimal" mode="dark" fill>
        <Suspense fallback={null}>
          <ConnectScreen />
        </Suspense>
      </ApxProvider>
    );
  return <Main />;
}

function Main() {
  const mode = useNav((s) => s.mode);
  const look = usePrefs((s) => s.look);
  const font = usePrefs((s) => s.font);
  const lang = useLanguage();
  const gate = useGate();
  useEffect(() => {
    void checkAccess();
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  return (
    <ApxProvider look={look} mode={mode} fill style={font === "mono" ? MONO : undefined}>
      {gate === "open" && <Panel />}
      {gate === "pair" && (
        <Suspense fallback={null}>
          <PairScreen />
        </Suspense>
      )}
    </ApxProvider>
  );
}

/** The app itself, once the core lets this panel in. */
function Panel() {
  const setup = useSetup((s) => s.open);
  useEffect(() => startLive(), []);
  useEffect(() => {
    if (!QUICK) void loadSetup();
  }, []);
  return (
    <>
      {QUICK ? <QuickChat /> : <Shell />}
      {!QUICK && setup && (
        <Suspense fallback={null}>
          <Wizard />
        </Suspense>
      )}
    </>
  );
}
