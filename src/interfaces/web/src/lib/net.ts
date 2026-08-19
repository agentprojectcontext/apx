import { STORAGE } from "../constants";

/**
 * Which address the panel talks to.
 *
 * Normally: this page's own origin, and none of this file does anything. It
 * matters when the panel is installed to a phone's home screen — the app then
 * keeps launching at whatever URL it was installed from, which is a promise the
 * network cannot keep. Installed from the Wi-Fi address, it is a dead icon on
 * mobile data; installed from the tailnet, it is a dead icon while Tailscale is
 * off.
 *
 * So the daemon publishes every address it answers at (GET /api/net/endpoints),
 * the panel remembers them, and a request that cannot reach the current one
 * tries the rest before giving up. The daemon allows exactly these
 * cross-origin calls (see host/daemon/api/net.js) — one process, several names.
 */

export interface Endpoint {
  url: string;
  kind: "tailscale-https" | "tailscale" | "lan" | "loopback";
  label: string;
  secure: boolean;
}

const BASE_KEY = "apx.api.base";
const CANDIDATES_KEY = "apx.api.candidates";

/** Absolute base URL, or "" meaning "this page's own origin". */
let base = read(BASE_KEY);

function read(key: string): string {
  try {
    return localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

function write(key: string, value: string) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    /* private mode / quota: the base still holds for this session */
  }
}

export function apiBase(): string {
  return base;
}

export function setApiBase(next: string) {
  base = (next || "").replace(/\/+$/, "");
  write(BASE_KEY, base);
}

/** Prefix a daemon path with the active base. Same-origin stays relative. */
export function apiUrl(path: string): string {
  return base ? `${base}${path}` : path;
}

/** Remember where else this daemon answers, for the next time one address
 *  stops working. Called whenever the endpoint list is successfully read. */
export function rememberEndpoints(endpoints: Endpoint[]) {
  write(CANDIDATES_KEY, JSON.stringify(endpoints.map((e) => e.url)));
}

export function knownCandidates(): string[] {
  try {
    const raw = JSON.parse(read(CANDIDATES_KEY) || "[]");
    return Array.isArray(raw) ? raw.filter((u): u is string => typeof u === "string") : [];
  } catch {
    return [];
  }
}

/** Does this address answer, right now? Short timeout: the whole point is to
 *  move on quickly, and an address that is not there fails by hanging. */
export async function probe(candidate: string, timeoutMs = 2500): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${candidate.replace(/\/+$/, "")}/api/health`, {
      signal: ctrl.signal,
      // No credentials: /health is unauthenticated, and a preflight here would
      // cost a round trip on every candidate we are only trying out.
      cache: "no-store",
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

let recovering: Promise<string | null> | null = null;

/**
 * The current address stopped answering: find one that does.
 *
 * Tries this page's own origin first (the failure may have been a blip), then
 * every remembered address in the order the daemon ranked them — the HTTPS
 * tailnet name before the tailnet IP before the LAN, because that is the order
 * of "keeps working the longest". Returns the new base, or null when nothing
 * answered, in which case the caller's original error stands.
 */
export function recoverConnection(): Promise<string | null> {
  if (recovering) return recovering;
  recovering = (async () => {
    const here = window.location.origin;
    const tried = new Set<string>();
    const order = [here, ...knownCandidates()];
    for (const candidate of order) {
      const url = candidate.replace(/\/+$/, "");
      if (!url || tried.has(url)) continue;
      tried.add(url);
      if (!(await probe(url))) continue;
      // Same origin as the page → back to relative URLs, which keeps requests
      // out of CORS entirely.
      setApiBase(url === here ? "" : url);
      return base;
    }
    return null;
  })().finally(() => {
    recovering = null;
  });
  return recovering;
}

/** True when this page can use the browser features that need a secure
 *  context: service workers (installing as an app), the microphone, the
 *  clipboard. http:// on a LAN address cannot, whatever the daemon does. */
export function isSecure(): boolean {
  return typeof window !== "undefined" && window.isSecureContext;
}

/** Whether the panel is running as an installed app rather than in a tab. */
export function isInstalled(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export { STORAGE };
