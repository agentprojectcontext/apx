// Quick public tunnels for local preview ports.
//
// Wraps zero-config tunnel providers so an ephemeral artifact preview running
// on http://localhost:<port> can be shared with a temporary public URL:
//   - cloudflared  → `cloudflared tunnel --url http://localhost:PORT`
//                    (no account needed; prints an https://*.trycloudflare.com URL)
//   - localtunnel  → `npx -y localtunnel --port PORT`
//                    (prints https://*.loca.lt; fallback when cloudflared absent)
//
// The manager spawns the provider, scrapes the public URL from its output, and
// tracks the child so it can be closed later. Children are best-effort killed
// on daemon exit.
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";

// Recognise the public URL each provider prints to stdout/stderr.
const URL_RE = /https?:\/\/[-a-z0-9.]+\.(?:trycloudflare\.com|loca\.lt)[^\s"']*/i;

// How long to wait for a provider to announce its URL before giving up.
const OPEN_TIMEOUT_MS = 25_000;

// Is `cloudflared` on PATH? Cached after first probe.
let _cloudflared = null;
function hasCloudflared() {
  if (_cloudflared !== null) return _cloudflared;
  try {
    const r = spawnSync("cloudflared", ["--version"], { stdio: "ignore" });
    _cloudflared = !r.error && r.status === 0;
  } catch {
    _cloudflared = false;
  }
  return _cloudflared;
}

// npx ships with npm; assume it's present when node is. Used for localtunnel.
function hasNpx() {
  try {
    const r = spawnSync("npx", ["--version"], { stdio: "ignore" });
    return !r.error && r.status === 0;
  } catch {
    return false;
  }
}

// Which providers are usable on this machine, best first.
export function detectProviders() {
  const out = [];
  if (hasCloudflared()) out.push("cloudflared");
  if (hasNpx()) out.push("localtunnel");
  return out;
}

function spawnProvider(provider, port) {
  if (provider === "cloudflared") {
    return spawn("cloudflared", ["tunnel", "--url", `http://localhost:${port}`], {
      stdio: ["ignore", "pipe", "pipe"],
    });
  }
  if (provider === "localtunnel") {
    return spawn("npx", ["-y", "localtunnel", "--port", String(port)], {
      stdio: ["ignore", "pipe", "pipe"],
    });
  }
  throw new Error(`unknown tunnel provider "${provider}"`);
}

export class TunnelManager {
  constructor() {
    /** @type {Map<string, object>} id → record */
    this.tunnels = new Map();
    // Kill any surviving children when the daemon process goes down.
    const cleanup = () => this.closeAllSync();
    process.once("exit", cleanup);
    process.once("SIGINT", () => { cleanup(); process.exit(130); });
    process.once("SIGTERM", () => { cleanup(); process.exit(143); });
  }

  static view(rec) {
    return { id: rec.id, url: rec.url, provider: rec.provider, port: rec.port, createdAt: rec.createdAt };
  }

  list() {
    return [...this.tunnels.values()].map((r) => TunnelManager.view(r));
  }

  // Open a tunnel to a local port. `provider` optional — auto-picks the best
  // available. Resolves once the public URL is announced.
  open(port, { provider } = {}) {
    const providers = detectProviders();
    if (providers.length === 0) {
      return Promise.reject(new Error(
        "no tunnel provider available. Install cloudflared (brew install cloudflared) " +
        "or ensure npx is on PATH for localtunnel."));
    }
    const chosen = provider && providers.includes(provider) ? provider : providers[0];

    return new Promise((resolve, reject) => {
      let child;
      try {
        child = spawnProvider(chosen, port);
      } catch (e) {
        return reject(e);
      }
      const id = randomUUID().slice(0, 8);
      let settled = false;
      let buf = "";

      const onData = (chunk) => {
        buf += chunk.toString("utf8");
        const m = buf.match(URL_RE);
        if (m && !settled) {
          settled = true;
          clearTimeout(timer);
          const rec = {
            id, url: m[0], provider: chosen, port, child,
            createdAt: new Date().toISOString(),
          };
          this.tunnels.set(id, rec);
          resolve(TunnelManager.view(rec));
        }
      };
      child.stdout?.on("data", onData);
      child.stderr?.on("data", onData);

      child.on("error", (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error(`tunnel (${chosen}) failed to start: ${err.message}`));
      });
      child.on("exit", (code) => {
        this._forget(id);
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error(`tunnel (${chosen}) exited before announcing a URL (code ${code}).`));
      });

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { child.kill("SIGTERM"); } catch { /* ignore */ }
        reject(new Error(`tunnel (${chosen}) timed out after ${OPEN_TIMEOUT_MS / 1000}s.`));
      }, OPEN_TIMEOUT_MS);
    });
  }

  _forget(id) {
    this.tunnels.delete(id);
  }

  close(id) {
    const rec = this.tunnels.get(id);
    if (!rec) return false;
    try { rec.child.kill("SIGTERM"); } catch { /* ignore */ }
    this.tunnels.delete(id);
    return true;
  }

  closeAllSync() {
    for (const rec of this.tunnels.values()) {
      try { rec.child.kill("SIGKILL"); } catch { /* ignore */ }
    }
    this.tunnels.clear();
  }
}

// Process-wide singleton, mirroring the preview registry.
export const tunnels = new TunnelManager();
