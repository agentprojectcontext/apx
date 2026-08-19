import { isInstalled, isSecure } from "./net";

/**
 * Installing the panel as an app.
 *
 * Two browsers, two rules, and neither of them is negotiable:
 *
 *   Android/Chrome asks for a manifest, icons, and a service worker that
 *   handles `fetch`. When all three are there it fires `beforeinstallprompt`,
 *   which we keep so the panel can offer the install itself instead of hoping
 *   the user finds it in the ⋮ menu.
 *
 *   iOS/Safari has no prompt at all and never will: "Add to Home Screen" lives
 *   in the share sheet and only the person holding the phone can tap it. It
 *   also ignores the manifest for standalone mode — the apple-mobile-web-app-*
 *   metas in index.html are what keep it out of a Safari tab.
 *
 * Both need a SECURE CONTEXT. https:// and localhost qualify; http:// on a LAN
 * address does not, so a panel reached at http://192.168.x.x cannot be
 * installed as an app no matter what this file does. That is the case for
 * `tailscale serve`, which is the only route here to a real certificate.
 */

export type InstallStance =
  | { kind: "installed" }
  | { kind: "prompt" }
  | { kind: "ios" }
  | { kind: "insecure" }
  | { kind: "unsupported" };

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();

function announce() {
  for (const fn of listeners) fn();
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    // Chrome shows its own mini-infobar unless we take the event; taking it
    // means the panel decides where the button goes.
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    announce();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    announce();
  });
}

export function onInstallStateChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  // iPadOS 13+ reports itself as a Mac; the touch points give it away.
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

/** What this browser can be offered right now. */
export function installStance(): InstallStance {
  if (isInstalled()) return { kind: "installed" };
  if (deferred) return { kind: "prompt" };
  if (isIos()) return isSecure() ? { kind: "ios" } : { kind: "insecure" };
  if (!isSecure()) return { kind: "insecure" };
  return { kind: "unsupported" };
}

/** Show Chrome's install dialog. Resolves to whether it was accepted. */
export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  const event = deferred;
  // One shot: the event cannot be used twice, and Chrome fires a fresh one if
  // the user dismisses and stays eligible.
  deferred = null;
  announce();
  try {
    await event.prompt();
    const { outcome } = await event.userChoice;
    return outcome === "accepted";
  } catch {
    return false;
  }
}

export function registerServiceWorker() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  // Registration THROWS on an insecure origin rather than returning false, and
  // an uncaught rejection on first paint is a scary console for a panel that is
  // working fine — the app is simply not installable there.
  if (!isSecure()) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      /* installability is a bonus, never a requirement to run */
    });
  });
}
