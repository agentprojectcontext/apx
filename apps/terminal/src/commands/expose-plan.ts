// How `apx2 expose` changes core.env, kept pure so it can be tested without touching the machine.
import crypto from "node:crypto";

export type ExposeMode = "tailscale" | "lan" | "off";

export type Exposure = { vars: Record<string, string>; generatedToken?: string };

export const newToken = () => crypto.randomBytes(32).toString("hex");

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

/** This machine's MagicDNS name from `tailscale status --json`, without the trailing dot. */
export function tailscaleDnsName(statusJson: string): string | undefined {
  try {
    const name = (JSON.parse(statusJson) as { Self?: { DNSName?: string } }).Self?.DNSName;
    return name ? name.replace(/\.$/, "") : undefined;
  } catch {
    return undefined;
  }
}

/** What the core will do with these settings, in words. */
export function describeExposure(vars: Record<string, string>): string {
  const host = vars.APX_HOST;
  if (vars.APX_PUBLIC_URL)
    return `published at ${vars.APX_PUBLIC_URL}${host && !isLoopback(host) ? ` and listening on ${host}` : " (the core itself stays on this computer)"}`;
  if (host && !isLoopback(host)) return `listening on ${host}: other devices on the network can reach it`;
  return "only this computer can reach the core";
}

const isLoopback = (h: string) => ["127.0.0.1", "::1", "localhost"].includes(h);
