// Which token the panel shows the core, and what a refusal means. Pure: no window, no client, so it is tested in Node.

/** Where a paired browser keeps the device token the core gave it. */
export const TOKEN_KEY = "apx.token";

export type TokenFrom = "desktop" | "stored" | "none";
export type KeyStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/**
 * A token this panel paired for itself comes first (a rejected one is cleared, so it never sticks); otherwise the
 * desktop app's, which knows the core it started.
 */
export function pickToken(
  desktop: string | undefined,
  storage: KeyStore | undefined,
): { token: string | undefined; from: TokenFrom } {
  let stored: string | null = null;
  try {
    stored = storage?.getItem(TOKEN_KEY) ?? null;
  } catch {
    // Storage may be blocked (private mode, site data off): the panel then goes without a stored token.
  }
  if (stored) return { token: stored, from: "stored" };
  return desktop ? { token: desktop, from: "desktop" } : { token: undefined, from: "none" };
}

/** A boot probe's outcome: the core refused this panel's token (or its lack of one), or anything else lets it in. */
export function needsPairing(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "unauthorized";
}

/** What the pairing screen says when the core turns a code down. */
export function pairError(err: unknown): "locked" | "badCode" | "failed" {
  const e = err as { code?: unknown; message?: unknown } | null;
  if (e?.code === "unauthorized") return /too many/i.test(String(e.message ?? "")) ? "locked" : "badCode";
  // A code too short or too long fails the params' check.
  if (e?.code === "bad_request") return "badCode";
  return "failed";
}

/** The operating system in a user agent, for the device's name in the owner's list. */
export function osName(ua: string): string | undefined {
  if (/iPhone|iPad|iPod/.test(ua)) return "iOS";
  if (/Android/.test(ua)) return "Android";
  if (/Mac OS X|Macintosh/.test(ua)) return "macOS";
  if (/Windows/.test(ua)) return "Windows";
  if (/CrOS/.test(ua)) return "ChromeOS";
  if (/Linux/.test(ua)) return "Linux";
  return undefined;
}
