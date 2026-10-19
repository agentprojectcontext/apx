// Who may talk to the core. Browsers always send Origin: only the APX panel's own origins pass.
// Native clients (terminal, desktop main process) send none. A token, when configured, is required everywhere.
import type { IncomingMessage } from "node:http";

export type Gate = {
  allowedOrigins: ReadonlySet<string>;
  token: string | undefined;
  /** Whether a token is a paired device's own (it stands in for the core's token, as the owner). */
  device?: ((token: string) => boolean) | undefined;
};

export function originsFor(coreUrl: string, extra: readonly string[] = []): Set<string> {
  const u = new URL(coreUrl);
  const set = new Set([
    `http://127.0.0.1:${u.port}`,
    `http://localhost:${u.port}`,
    "http://127.0.0.1:7441",
    "http://localhost:7441",
  ]);
  for (const o of extra) set.add(o);
  return set;
}

/**
 * undefined = allowed; otherwise the reason to refuse. `knownClient`: the request carries a valid client token, which
 * stands in for the core's token (the app still acts as a model, within its scopes). `open`: a method callable without
 * a token (pairing a device). A paired device's own token passes like the core's.
 */
export function refuse(
  req: IncomingMessage,
  gate: Gate,
  tokenFromQuery?: string | null,
  knownClient = false,
  open = false,
): string | undefined {
  const origin = req.headers.origin;
  if (origin && !gate.allowedOrigins.has(origin)) return `origin ${origin} is not allowed`;
  // Without a token the core is this computer's only. A request a proxy forwarded (tailscale serve, a reverse
  // proxy) comes from elsewhere even though it arrives on loopback.
  if (!gate.token && !open && forwarded(req)) return "a request through a proxy needs APX_TOKEN on the core";
  if (gate.token && !knownClient && !open) {
    const auth = req.headers.authorization;
    const bearer = auth?.startsWith("Bearer ") ? auth.slice(7) : undefined;
    if (bearer === gate.token || tokenFromQuery === gate.token) return undefined;
    const presented = bearer ?? tokenFromQuery ?? undefined;
    if (!presented || !gate.device?.(presented)) return "missing or bad token";
  }
  return undefined;
}

/** Nodes lend capabilities (browser, files): only native clients may register as one. */
export function mayBeNode(req: IncomingMessage): boolean {
  return !req.headers.origin;
}

const PROXY_HEADERS = ["x-forwarded-for", "forwarded", "x-real-ip", "tailscale-user-login"];
const forwarded = (req: IncomingMessage) => PROXY_HEADERS.some((h) => req.headers[h] !== undefined);

/** Loopback is necessary, but an SSH forward is indistinguishable from a direct connection. */
export function localRequest(req: IncomingMessage): boolean {
  if (forwarded(req)) return false;
  const peer = req.socket.remoteAddress;
  if (peer !== "127.0.0.1" && peer !== "::1" && peer !== "::ffff:127.0.0.1") return false;
  const localHost = (url: string) => {
    try {
      return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname);
    } catch {
      return false;
    }
  };
  return localHost(`http://${req.headers.host ?? ""}`) && (!req.headers.origin || localHost(req.headers.origin));
}
