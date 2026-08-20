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

/**
 * The WebSocket URL for a daemon path — same address the HTTP calls use.
 *
 * Not `window.location.host`: an installed app can be talking to a base that is
 * not the page's origin (see above), and a socket opened against the page would
 * quietly go to a machine the rest of the panel stopped using.
 */
export function wsUrl(path: string, params: Record<string, string | null | undefined> = {}): string {
  const href = apiUrl(path);
  const url = new URL(href.startsWith("http") ? href : `${window.location.origin}${href}`);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
  }
  return url.toString();
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

/**
 * Is an APX daemon answering at this address, right now?
 *
 * Not "did something answer": a LAN address is a lease, and the 192.168.x.x
 * that was this Mac yesterday can be a printer today — one that cheerfully
 * returns 200s, or 404s, for everything. So the check is that the body is
 * OUR health payload. Short timeout, because the whole point is to move on
 * quickly and an address that is not there fails by hanging.
 */
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
    if (!res.ok) return false;
    const body = (await res.json().catch(() => null)) as { status?: string; version?: string } | null;
    return body?.status === "ok" && typeof body.version === "string";
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A response came back wrong in a way an address change would explain — a 404
 * where a route should be, a gateway error. Confirm the daemon is still on the
 * other end of the CURRENT address before believing it, and fail over when it
 * is not.
 *
 * This is the half that a rejected fetch does not cover. Leaving the house does
 * not always produce a network error: the same private address is handed out on
 * every network, so the phone reconnects to *something* and gets a stranger's
 * 404 instead of silence.
 *
 * Returns true when it moved (the caller should retry).
 */
export async function recoverIfAddressIsWrong(): Promise<boolean> {
  const current = base || window.location.origin;
  if (await probe(current, 1500)) return false; // the daemon is there; the error is real
  return (await recoverConnection()) !== null;
}

/** Statuses worth a second look. A 401 is an auth problem and a 400 is our own
 *  bad request — neither is fixed by talking to a different address. */
export function mayBeWrongAddress(status: number): boolean {
  return status === 404 || status === 502 || status === 503 || status === 504;
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
