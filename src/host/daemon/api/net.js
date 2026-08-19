// GET  /net/endpoints        every URL this daemon can be reached at
// POST /net/tailscale/serve  publish it over HTTPS on the tailnet
// DELETE /net/tailscale/serve  stop publishing
//
// One daemon, several addresses: loopback for the toolchain, a LAN address for
// a phone on the same Wi-Fi, and — when Tailscale is up — a name that keeps
// working from a train. The panel needs the whole list for two reasons: to show
// you which URL to install the app from, and so a client whose address stopped
// answering can try the others instead of just failing.
//
// The HTTPS one is not interchangeable with the others. Service workers (the
// installable app), getUserMedia (voice notes) and the clipboard are all gated
// on a secure context, so over http://192.168.x.x the browser switches them
// off. `tailscale serve` is the only way to a real certificate here that does
// not involve buying a domain.
import os from "node:os";
import { effectivePort, effectiveHost, readConfig } from "#core/config/index.js";
import { detectLanAddresses, isLoopback, isWildcard } from "#core/net/lan.js";
import {
  disableTailscaleServe,
  enableTailscaleServe,
  tailscaleServe,
  tailscaleStatus,
} from "#core/net/tailscale.js";
import { asyncRoute } from "./shared.js";

/** A Tailscale address, so a LAN scan does not report the tailnet as Wi-Fi. */
function isTailscaleAddress(address, iface) {
  if (/^utun|^tailscale/i.test(String(iface || ""))) return true;
  const p = String(address || "").split(".").map(Number);
  // 100.64.0.0/10 — the CGNAT range Tailscale hands out.
  return p[0] === 100 && p[1] >= 64 && p[1] <= 127;
}

/**
 * Every base URL that reaches this daemon, best first.
 *
 * "Best" is ordered by how long it keeps working: the HTTPS tailnet name (from
 * anywhere, and a secure context), then the tailnet IP, then the LAN, then
 * loopback, which only ever helps the machine it runs on.
 */
export async function reachableEndpoints({ port, host }) {
  const out = [];
  const ts = await tailscaleStatus();
  const serve = ts.running ? await tailscaleServe(port) : { serving: false, url: null };

  if (serve.serving && serve.url) {
    out.push({ url: serve.url, kind: "tailscale-https", label: ts.dnsName || "tailscale", secure: true });
  }
  if (ts.running && ts.ipv4) {
    out.push({ url: `http://${ts.ipv4}:${port}`, kind: "tailscale", label: ts.hostname || "tailscale", secure: false });
  }

  // A daemon bound to one specific address is only reachable there; a wildcard
  // (or loopback-only, which still runs the LAN listener when shared) is
  // reachable at every interface it holds.
  const bound = host && !isLoopback(host) && !isWildcard(host) ? host : null;
  if (bound && !out.some((e) => e.url.includes(bound))) {
    out.push({ url: `http://${bound}:${port}`, kind: "lan", label: "LAN", secure: false });
  }
  if (!bound) {
    for (const a of detectLanAddresses()) {
      if (isTailscaleAddress(a.address, a.iface)) continue;
      out.push({ url: `http://${a.address}:${port}`, kind: "lan", label: a.iface, secure: false });
    }
  }

  out.push({ url: `http://127.0.0.1:${port}`, kind: "loopback", label: os.hostname(), secure: true });
  // Deduplicate while keeping the first (best) spelling of each URL.
  const seen = new Set();
  return out.filter((e) => (seen.has(e.url) ? false : seen.add(e.url)));
}

/** Hostnames that are this daemon under another name — the CORS allowlist. */
export async function selfOrigins({ port, host }) {
  const eps = await reachableEndpoints({ port, host });
  return new Set(eps.map((e) => new URL(e.url).host));
}

// ── CORS, narrowly: this daemon under one of its OWN other names ───────────
//
// The panel installed from one address (say the LAN) can end up talking to
// another (the tailnet) when the first stops answering. That is a cross-origin
// request to the same process, and it needs a header to be allowed — but only
// for hosts that ARE us. Anything else, including a page on the same port at
// some other hostname, gets nothing.
//
// The allowlist is cached: building it asks Tailscale, which is far too slow to
// do per request. Loopback and the LAN are known synchronously and seeded
// immediately, so the first request is answered correctly even before the
// asynchronous half lands.
const CORS_TTL_MS = 30_000;
let allowCache = { at: 0, hosts: null, refreshing: false };

function knownHostsSync({ port, host }) {
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  if (host && !isLoopback(host) && !isWildcard(host)) hosts.add(`${host}:${port}`);
  for (const a of detectLanAddresses()) hosts.add(`${a.address}:${port}`);
  return hosts;
}

function refreshAllowed(ctx) {
  if (allowCache.refreshing) return;
  allowCache.refreshing = true;
  selfOrigins(ctx)
    .then((hosts) => {
      allowCache = { at: Date.now(), hosts, refreshing: false };
    })
    .catch(() => {
      allowCache = { ...allowCache, at: Date.now(), refreshing: false };
    });
}

/** Express middleware allowing cross-origin calls between our own addresses. */
export function corsBetweenOwnAddresses({ port, host }) {
  const ctx = { port, host };
  return function cors(req, res, next) {
    const origin = req.headers.origin;
    if (!origin) return next();
    if (!allowCache.hosts || Date.now() - allowCache.at > CORS_TTL_MS) {
      if (!allowCache.hosts) allowCache = { ...allowCache, hosts: knownHostsSync(ctx) };
      refreshAllowed(ctx);
    }
    let originHost = "";
    try {
      originHost = new URL(origin).host;
    } catch {
      return next();
    }
    if (!allowCache.hosts.has(originHost)) return next();
    res.setHeader("access-control-allow-origin", origin);
    res.setHeader("vary", "Origin");
    res.setHeader("access-control-allow-credentials", "true");
    if (req.method === "OPTIONS") {
      res.setHeader("access-control-allow-methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
      res.setHeader(
        "access-control-allow-headers",
        req.headers["access-control-request-headers"] || "authorization,content-type",
      );
      res.setHeader("access-control-max-age", "600");
      return res.status(204).end();
    }
    return next();
  };
}

export function register(api) {
  api.get("/net/endpoints", asyncRoute(async (_req, res) => {
    const cfg = readConfig();
    const port = effectivePort(cfg);
    const host = effectiveHost(cfg);
    const ts = await tailscaleStatus();
    const serve = ts.installed ? await tailscaleServe(port) : { serving: false, url: null, error: null };
    res.json({
      port,
      bind: host,
      shared: !isLoopback(host),
      endpoints: await reachableEndpoints({ port, host }),
      tailscale: { ...ts, serving: serve.serving, serve_url: serve.url, serve_error: serve.error },
    });
  }));

  api.post("/net/tailscale/serve", asyncRoute(async (_req, res) => {
    const port = effectivePort(readConfig());
    try {
      const out = await enableTailscaleServe(port);
      res.json({ ok: true, ...out });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message });
    }
  }));

  api.delete("/net/tailscale/serve", asyncRoute(async (_req, res) => {
    const port = effectivePort(readConfig());
    try {
      const out = await disableTailscaleServe(port);
      res.json({ ok: true, ...out });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message });
    }
  }));
}
