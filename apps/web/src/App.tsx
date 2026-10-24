import { ApxProvider } from "@apx/ui";
import { type CSSProperties, Suspense, useEffect } from "react";
import { startLive } from "./data/live.ts";
import { checkAccess, useGate } from "./data/pairing.ts";
import { usePrefs } from "./data/prefs.ts";
import { loadSetup, useSetup } from "./data/setup.ts";
import { loadTelemetry } from "./data/telemetry.ts";
import { useLanguage } from "./i18n/index.ts";
import {
  AboutScreen,
  ArtifactWindow,
  BrowserPanel,
  ConnectScreen,
  OAuthReturn,
  PairScreen,
  QuickChat,
  Wizard,
} from "./lazy.ts";
import { IS_BROWSER_WINDOW } from "./panel/browserWindow.ts";
import { useNav } from "./shell/nav.ts";
import { Shell } from "./shell/Shell.tsx";

/** The page Google sends the browser back to after the owner signs in (the core serves the panel there). */
const OAUTH_RETURN = window.location.pathname === "/oauth/google";

/** The desktop app's menu-bar window loads the panel with ?quick: only the quick chat. */
const QUICK = new URLSearchParams(window.location.search).has("quick");

// Settings › Appearance › Font: swapping the sans token reaches every component, overlays included.
const MONO = { "--apx-font-sans": "var(--apx-font-mono)" } as CSSProperties;

/** The desktop app's first run (?connect): no APX is chosen yet, so nothing calls a core. */
const CONNECT = new URLSearchParams(window.location.search).has("connect") && Boolean(window.apxConnect);

/** One artifact in a window or tab of its own (?artifact=<id>). */
const ARTIFACT = new URLSearchParams(window.location.search).get("artifact") ?? undefined;

/** The desktop app's About window (?about): the hero with this build's version; no core either. */
const ABOUT = new URLSearchParams(window.location.search).has("about");

export function App() {
  if (CONNECT || ABOUT)
    return (
      <ApxProvider look="minimal" mode="dark" fill>
        <Suspense fallback={null}>{ABOUT ? <AboutScreen /> : <ConnectScreen />}</Suspense>
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
    window.apxDesktop?.setLanguage?.(lang);
  }, [lang]);
  return (
    <ApxProvider look={look} mode={mode} fill style={font === "mono" ? MONO : undefined}>
      {/* Google's return page finishes without pairing: the browser it lands in may be any. */}
      {OAUTH_RETURN && (
        <Suspense fallback={null}>
          <OAuthReturn />
        </Suspense>
      )}
      {!OAUTH_RETURN && gate === "open" && <Panel />}
      {!OAUTH_RETURN && gate === "pair" && (
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
    if (QUICK || IS_BROWSER_WINDOW || ARTIFACT) return;
    void loadSetup();
    void loadTelemetry();
  }, []);
  if (ARTIFACT)
    return (
      <Suspense fallback={null}>
        <ArtifactWindow id={ARTIFACT} />
      </Suspense>
    );
  // The desktop app's browser window (?browser): only the browser panel.
  if (IS_BROWSER_WINDOW)
    return (
      <div className="browserwin">
        <Suspense fallback={null}>
          <BrowserPanel />
        </Suspense>
      </div>
    );
  return (
    <>
      {QUICK ? (
        <Suspense fallback={null}>
          <QuickChat />
        </Suspense>
      ) : (
        <Shell />
      )}
      {!QUICK && setup && (
        <Suspense fallback={null}>
          <Wizard />
        </Suspense>
      )}
    </>
  );
}
