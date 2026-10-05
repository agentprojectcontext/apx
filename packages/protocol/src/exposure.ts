// Who may reach the core, as core.env says it: this computer only, the local network, or the owner's tailnet. Pure,
// shared by `apx expose` and the core's access.* methods.

import type { AccessMode } from "./device-methods.ts";

export type ExposeMode = "tailscale" | "lan" | "off";

export type Exposure = { vars: Record<string, string>; generatedToken?: string };

/** 32 random bytes as hex (Web Crypto: the same in Node and the browser). */
export const newToken = (): string =>
  Array.from(globalThis.crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");

/** The new core.env for a mode. A token is created only when exposure needs one and none exists; `off` keeps it. */
export function planExposure(
  current: Record<string, string>,
  mode: ExposeMode,
  o: { tailscaleUrl?: string; token?: () => string } = {},
): Exposure {
  const vars = { ...current };
  delete vars.APX_HOST;
  delete vars.APX_PUBLIC_URL;
  if (mode === "off") return { vars };
  let generatedToken: string | undefined;
  if (!vars.APX_TOKEN) {
    generatedToken = (o.token ?? newToken)();
    vars.APX_TOKEN = generatedToken;
  }
  if (mode === "lan") vars.APX_HOST = "0.0.0.0";
  else {
    if (!o.tailscaleUrl) throw new Error("tailscale exposure needs this machine's Tailscale name");
    vars.APX_PUBLIC_URL = o.tailscaleUrl;
  }
  return generatedToken ? { vars, generatedToken } : { vars };
}

/** Which of the three a set of settings means (a public URL is the tailnet's; a non-loopback host, the network). */
export function accessOf(vars: { APX_HOST?: string | undefined; APX_PUBLIC_URL?: string | undefined }): AccessMode {
  if (vars.APX_PUBLIC_URL) return "tailscale";
  if (vars.APX_HOST && !isLoopback(vars.APX_HOST)) return "lan";
  return "local";
}

/** This machine's MagicDNS name from `tailscale status --json`, without the trailing dot. */
export function tailscaleDnsName(statusJson: string): string | undefined {
  try {
    const name = (JSON.parse(statusJson) as { Self?: { DNSName?: string } }).Self?.DNSName;
    return name ? name.replace(/\.$/, "") : undefined;
  } catch {
    return undefined;
  }
}

export const isLoopback = (h: string) => ["127.0.0.1", "::1", "localhost"].includes(h);
