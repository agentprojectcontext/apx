// Who may talk to the core. Browsers always send Origin: only the APX panel's own origins pass.
// Native clients (terminal, desktop main process) send none. A token, when configured, is required everywhere.
import type { IncomingMessage } from "node:http";

export type Gate = { allowedOrigins: ReadonlySet<string>; token: string | undefined };

export function originsFor(coreUrl: string, extra: string | undefined): Set<string> {
  const u = new URL(coreUrl);
  const set = new Set([
    `http://127.0.0.1:${u.port}`,
    `http://localhost:${u.port}`,
    "http://127.0.0.1:7441",
    "http://localhost:7441",
  ]);
  for (const o of (extra ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean))
    set.add(o);
  return set;
}

/** undefined = allowed; otherwise the reason to refuse. */
export function refuse(req: IncomingMessage, gate: Gate, tokenFromQuery?: string | null): string | undefined {
  const origin = req.headers.origin;
  if (origin && !gate.allowedOrigins.has(origin)) return `origin ${origin} is not allowed`;
  if (gate.token) {
    const auth = req.headers.authorization;
    if (auth !== `Bearer ${gate.token}` && tokenFromQuery !== gate.token) return "missing or bad token";
  }
  return undefined;
}

/** Nodes lend capabilities (browser, files): only native clients may register as one. */
export function mayBeNode(req: IncomingMessage): boolean {
  return !req.headers.origin;
}
