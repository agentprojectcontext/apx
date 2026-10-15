// Why the phone cannot reach its core: no internet at all, or the internet works and the computer does not answer at
// its address. Pure: no React Native here, so it runs under node:test.

/** Where the paired core lives, read from its address. */
export type AddressKind = "tailscale" | "local" | "other";

/** What the owner should check first. */
export type Offline = "noInternet" | "tailscale" | "localNetwork" | "server";

/** Probed only once the core fails: endpoints phones already use for their own captive-portal checks. */
const INTERNET_PROBES = [
  "https://connectivitycheck.gstatic.com/generate_204",
  "https://www.cloudflare.com/cdn-cgi/trace",
];

export function addressKind(url: string): AddressKind {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return "other";
  }
  if (host.endsWith(".ts.net")) return "tailscale";
  const ip = host.split(".").map(Number);
  if (ip.length === 4 && ip.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
    const [a, b] = ip as [number, number];
    // 100.64.0.0/10 is carrier-grade NAT space, which Tailscale hands out to every machine on a tailnet.
    if (a === 100 && b >= 64 && b <= 127) return "tailscale";
    if (a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)) return "local";
    if (a === 169 && b === 254) return "local";
    return "other";
  }
  if (host === "localhost" || host.endsWith(".local") || !host.includes(".")) return "local";
  return "other";
}

export function diagnose(internet: boolean, kind: AddressKind): Offline {
  if (!internet) return "noInternet";
  if (kind === "tailscale") return "tailscale";
  if (kind === "local") return "localNetwork";
  return "server";
}

/** Whether any public endpoint answers; `probe` is injected by tests. */
export async function hasInternet(probe: (url: string) => Promise<boolean> = reachable): Promise<boolean> {
  try {
    return await Promise.any(INTERNET_PROBES.map(async (u) => ((await probe(u)) ? true : Promise.reject())));
  } catch {
    return false;
  }
}

async function reachable(url: string): Promise<boolean> {
  try {
    await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(4000) });
    return true;
  } catch {
    return false;
  }
}
