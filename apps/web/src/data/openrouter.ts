// OpenRouter's sign-in from the panel: its approval page in a window of its own, then waiting for its key to land.
import { useEffect, useState } from "react";
import { client } from "./client.ts";
import { notify } from "./notices.ts";
import { loadProviders } from "./providers.ts";
import { markSignInWindow, onSignInDone } from "./signInWindow.ts";

const POPUP_FEATURES = "popup,width=560,height=780";
/** How often the providers are read while OpenRouter's page is open elsewhere. */
const POLL_MS = 2000;

/**
 * Opens OpenRouter's approval page, on the click itself so a popup blocker lets it through, pointed there once the
 * core answers. The desktop app sends it to the system browser. Resolves whether the page opened.
 */
async function connectOpenRouter(): Promise<boolean> {
  const tab = window.apxDesktop ? null : window.open("about:blank", "apx-openrouter", POPUP_FEATURES);
  try {
    const { url } = await client.call("openrouter.connect", { callback: `${window.location.origin}/oauth/openrouter` });
    markSignInWindow();
    if (tab) tab.location.href = url;
    else window.open(url, "_blank");
    return true;
  } catch (e) {
    tab?.close();
    notify(e instanceof Error ? e.message : String(e));
    return false;
  }
}

/** Connecting: opens the page, then reads the providers until OpenRouter has its key (or the window says it is done). */
export function useOpenRouterConnect(connected: boolean): { waiting: boolean; connect: () => void } {
  const [waiting, setWaiting] = useState(false);
  useEffect(() => {
    if (!waiting || connected) return;
    const id = setInterval(() => void loadProviders(), POLL_MS);
    const stop = onSignInDone(() => void loadProviders());
    return () => {
      clearInterval(id);
      stop();
    };
  }, [waiting, connected]);
  return {
    waiting: waiting && !connected,
    connect: () => void connectOpenRouter().then((opened) => opened && setWaiting(true)),
  };
}
