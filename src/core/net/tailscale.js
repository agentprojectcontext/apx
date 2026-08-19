// Tailscale, as far as the daemon needs to care about it.
//
// The panel has two ways off this machine and they solve different problems.
// `apx panel share` binds a LAN address: fast, private, and useless the moment
// the phone leaves the house. Tailscale gives the same daemon a stable name
// that works from anywhere, and — with `tailscale serve` — a real HTTPS
// certificate for it.
//
// That certificate is not a nicety. A browser only grants a SECURE CONTEXT to
// https:// and localhost, and without one there is no service worker (so no
// installable app on Android), no microphone (so no voice notes) and no
// clipboard. Over plain http://192.168.x.x the panel works but those three are
// switched off by the browser, not by us.
//
// Everything here is best-effort and read-only unless explicitly asked: a
// machine with no Tailscale reports `installed: false` and nothing breaks.
import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs";
import { promisify } from "node:util";

const run = promisify(execFile);

// The App Store build keeps its CLI inside the bundle; the open-source and
// Homebrew builds put it on PATH. Order is "most specific first".
const CANDIDATES = [
  "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
  "/usr/local/bin/tailscale",
  "/opt/homebrew/bin/tailscale",
  "/usr/bin/tailscale",
  "/usr/sbin/tailscale",
];

let cachedBinary;

/** Path to the tailscale CLI, or null when it is not installed. */
export function tailscaleBinary() {
  if (cachedBinary !== undefined) return cachedBinary;
  for (const p of CANDIDATES) {
    try {
      if (fs.existsSync(p)) return (cachedBinary = p);
    } catch {
      /* unreadable path: try the next */
    }
  }
  try {
    const found = execFileSync("command", ["-v", "tailscale"], { shell: true, encoding: "utf8" }).trim();
    if (found) return (cachedBinary = found);
  } catch {
    /* not on PATH either */
  }
  return (cachedBinary = null);
}

/**
 * What Tailscale is doing right now.
 *
 * `running` means the node is actually up and has an address — an installed
 * but logged-out Tailscale reports BackendState "Stopped" and no IPs, which
 * for our purposes is the same as absent.
 *
 * @returns {Promise<{installed:boolean, running:boolean, state:string|null,
 *   ipv4:string|null, hostname:string|null, dnsName:string|null, error:string|null}>}
 */
export async function tailscaleStatus() {
  const bin = tailscaleBinary();
  const off = {
    installed: !!bin,
    running: false,
    state: null,
    ipv4: null,
    hostname: null,
    dnsName: null,
    error: null,
  };
  if (!bin) return off;
  let json;
  try {
    const { stdout } = await run(bin, ["status", "--json"], { timeout: 4000, maxBuffer: 4 << 20 });
    json = JSON.parse(stdout);
  } catch (e) {
    return { ...off, error: e?.message || String(e) };
  }
  const self = json?.Self || {};
  const ips = Array.isArray(self.TailscaleIPs) ? self.TailscaleIPs : [];
  const ipv4 = ips.find((ip) => typeof ip === "string" && ip.includes(".")) || null;
  // DNSName arrives fully qualified with a trailing dot ("mini.tailnet.ts.net.").
  const dnsName = String(self.DNSName || "").replace(/\.$/, "") || null;
  const state = json?.BackendState || null;
  return {
    installed: true,
    running: state === "Running" && !!ipv4,
    state,
    ipv4,
    hostname: self.HostName || null,
    dnsName,
    error: null,
  };
}

/**
 * Whether `tailscale serve` is already publishing something, and the HTTPS URL
 * it publishes it at. We only claim the URL when the proxy target is the port
 * we were asked about — another service on the same tailnet name is not ours.
 *
 * @returns {Promise<{serving:boolean, url:string|null, error:string|null}>}
 */
export async function tailscaleServe(port) {
  const bin = tailscaleBinary();
  if (!bin) return { serving: false, url: null, error: null };
  let cfg;
  try {
    const { stdout } = await run(bin, ["serve", "status", "--json"], { timeout: 4000 });
    cfg = JSON.parse(stdout || "{}");
  } catch (e) {
    // `serve status` exits non-zero when nothing is being served — that is an
    // answer, not a failure.
    return { serving: false, url: null, error: /not.*(serv|config)/i.test(e?.message || "") ? null : e?.message || null };
  }
  const wanted = `http://127.0.0.1:${port}`;
  const web = cfg?.Web || {};
  for (const [hostPort, entry] of Object.entries(web)) {
    for (const handler of Object.values(entry?.Handlers || {})) {
      const proxy = String(handler?.Proxy || "");
      if (!proxy.includes(`:${port}`)) continue;
      if (proxy !== wanted && !proxy.includes("localhost")) continue;
      // Keys look like "mini.tailnet.ts.net:443" — :443 is implied in a URL.
      const host = hostPort.replace(/:443$/, "");
      return { serving: true, url: `https://${host}`, error: null };
    }
  }
  return { serving: false, url: null, error: null };
}

/**
 * Publish the daemon at https://<machine>.<tailnet>.ts.net.
 *
 * Deliberately NOT funnel: `serve` is reachable only by devices signed into the
 * same tailnet, `funnel` would put it on the public internet. This is the one
 * function here that changes anything, and only the CLI calls it.
 */
export async function enableTailscaleServe(port) {
  const bin = tailscaleBinary();
  if (!bin) throw new Error("tailscale is not installed");
  const status = await tailscaleStatus();
  if (!status.running) {
    throw new Error(`tailscale is installed but not running (state: ${status.state || "unknown"}) — sign in first`);
  }
  try {
    await run(bin, ["serve", "--bg", `http://127.0.0.1:${port}`], { timeout: 20000 });
  } catch (e) {
    const detail = (e?.stderr || e?.message || "").toString().trim();
    throw new Error(detail || "tailscale serve failed");
  }
  return tailscaleServe(port);
}

/** Stop publishing. */
export async function disableTailscaleServe(port) {
  const bin = tailscaleBinary();
  if (!bin) throw new Error("tailscale is not installed");
  try {
    await run(bin, ["serve", "--https=443", "off"], { timeout: 15000 });
  } catch {
    // Older CLIs spell it differently; the reset form covers both.
    await run(bin, ["serve", "reset"], { timeout: 15000 });
  }
  return tailscaleServe(port);
}
