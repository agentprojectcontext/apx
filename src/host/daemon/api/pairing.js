// QR-based pairing for companion clients (APX Deck app, etc.).
//
// Flow:
//   1. `apx pair` CLI hits POST /pair/init from localhost. Daemon mints a
//      short-lived pairing_id (90 s TTL) and prints a QR with
//      { url, pid, fp } so the device can identify the daemon.
//   2. Device scans QR, POSTs { pairing_id, label } to /pair/confirm.
//      Daemon validates the nonce, generates a per-client token via
//      the token store, returns { token, daemon_url, fingerprint }.
//   3. CLI is polling GET /pair/status/:pairing_id and shows "paired ✓"
//      once the nonce is consumed.
//
// Endpoints under /pair/* are exempt from the bearer auth middleware
// (see api/shared.js — UNAUTHENTICATED_PREFIXES). /pair/init enforces
// its own localhost-only check; /pair/confirm is gated by the nonce.
// /pair/list and /pair/revoke ARE authenticated — they expose paired
// device info, so they sit behind the auth middleware via a small
// trick: we register them on a sub-router with its own auth check.

import { randomUUID } from "node:crypto";
import os from "node:os";

const PAIRING_TTL_MS = 90_000;

// Reachable base URLs a device on the LAN can hit. When the daemon binds to
// the wildcard (0.0.0.0/::) we enumerate non-internal IPv4s; when it binds to
// a concrete host we use that. Loopback is always last (only useful for the
// host itself / adb reverse). Used to build the scan-to-login QR.
function reachableUrls({ host, port }) {
  const p = port || 7430;
  const urls = [];
  if (host && host !== "0.0.0.0" && host !== "::" && host !== "127.0.0.1") {
    urls.push(`http://${host}:${p}`);
  }
  if (host === "0.0.0.0" || host === "::" || !host) {
    for (const list of Object.values(os.networkInterfaces())) {
      for (const i of list || []) {
        if (i.family === "IPv4" && !i.internal) urls.push(`http://${i.address}:${p}`);
      }
    }
  }
  urls.push(`http://127.0.0.1:${p}`);
  return [...new Set(urls)];
}

// pairing_id → { expires_at, confirmed_at, device_label, client_id }
const sessions = new Map();

function isLocalhost(req) {
  // Express sets req.ip respecting trust proxy; for the daemon we trust
  // only the raw socket address.
  const addr = req.socket?.remoteAddress || req.ip || "";
  return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
}

function purgeExpired(now = Date.now()) {
  for (const [id, s] of sessions) {
    // Keep confirmed sessions around briefly so the CLI can read status.
    const cutoff = s.confirmed_at ? s.confirmed_at + 30_000 : s.expires_at;
    if (cutoff < now) sessions.delete(id);
  }
}

export function register(app, ctx) {
  const { tokenStore, config } = ctx;
  if (!tokenStore) {
    // Pairing requires the multi-token store; if running with legacy
    // single-token mode just don't register the routes. Devices can fall
    // back to the master token via env var.
    return;
  }

  // ── POST /pair/init ───────────────────────────────────────────────
  // Localhost-only. Returns { pairing_id, expires_at }. No body needed.
  app.post("/pair/init", (req, res) => {
    if (!isLocalhost(req)) {
      return res.status(403).json({ error: "pair/init: localhost only" });
    }
    purgeExpired();
    const pairing_id = randomUUID();
    const now = Date.now();
    const expires_at = now + PAIRING_TTL_MS;
    sessions.set(pairing_id, {
      expires_at,
      confirmed_at: null,
      device_label: null,
      client_id: null,
    });
    res.json({
      pairing_id,
      expires_at: new Date(expires_at).toISOString().replace(/\.\d{3}Z$/, "Z"),
      ttl_ms: PAIRING_TTL_MS,
      fingerprint: tokenStore.masterFingerprint(),
      daemon: {
        host: config?.host || "127.0.0.1",
        port: config?.port || 7430,
      },
      // Base URLs a LAN device can reach; the web builds `<url>/#pair=<pid>`
      // so a phone can scan a QR and land already authenticating.
      lan_urls: reachableUrls({ host: config?.host, port: config?.port }),
    });
  });

  // ── POST /pair/confirm ────────────────────────────────────────────
  // App side. Body: { pairing_id, label?, fingerprint? }. Returns the
  // new client token. Nonce is one-shot.
  app.post("/pair/confirm", (req, res) => {
    purgeExpired();
    const { pairing_id, label, fingerprint, kind } = req.body || {};
    if (!pairing_id || typeof pairing_id !== "string") {
      return res.status(400).json({ error: "pair/confirm: pairing_id required" });
    }
    const s = sessions.get(pairing_id);
    if (!s) {
      return res.status(404).json({ error: "pair/confirm: unknown or expired pairing_id" });
    }
    if (s.confirmed_at) {
      return res.status(409).json({ error: "pair/confirm: already confirmed" });
    }
    if (Date.now() > s.expires_at) {
      sessions.delete(pairing_id);
      return res.status(410).json({ error: "pair/confirm: pairing_id expired" });
    }
    // Optional: device echoes back the fingerprint it saw on the QR.
    // We don't reject mismatches (the daemon is the only one minting
    // them anyway), but we surface it back so the device can decide.
    const expectedFp = tokenStore.masterFingerprint();

    const client = tokenStore.addClient(label || "device", kind || "device");
    s.confirmed_at = Date.now();
    s.device_label = client.label;
    s.client_id = client.id;

    res.json({
      token: client.token,
      client_id: client.id,
      label: client.label,
      kind: client.kind,
      daemon_url: `http://${config?.host || "127.0.0.1"}:${config?.port || 7430}`,
      fingerprint: expectedFp,
      fingerprint_match:
        typeof fingerprint === "string" ? fingerprint === expectedFp : null,
    });
  });

  // ── GET /pair/status/:pairing_id ──────────────────────────────────
  // For the CLI to poll while showing the QR. Returns pending|confirmed
  // |expired. Never leaks the token.
  app.get("/pair/status/:pairing_id", (req, res) => {
    purgeExpired();
    const s = sessions.get(req.params.pairing_id);
    if (!s) return res.json({ status: "unknown" });
    if (s.confirmed_at) {
      return res.json({
        status: "confirmed",
        device_label: s.device_label,
        client_id: s.client_id,
        confirmed_at: new Date(s.confirmed_at).toISOString().replace(/\.\d{3}Z$/, "Z"),
      });
    }
    if (Date.now() > s.expires_at) return res.json({ status: "expired" });
    return res.json({
      status: "pending",
      expires_at: new Date(s.expires_at).toISOString().replace(/\.\d{3}Z$/, "Z"),
    });
  });

  // ── GET /pair/list ────────────────────────────────────────────────
  // Authenticated (auth middleware exempts /pair/*, so we re-check by
  // hand here — only the master or an existing client can list peers).
  app.get("/pair/list", (req, res) => {
    if (!checkBearer(req, tokenStore)) return res.status(401).json({ error: "unauthorized" });
    res.json({ clients: tokenStore.list() });
  });

  // ── DELETE /pair/revoke/:id ───────────────────────────────────────
  app.delete("/pair/revoke/:id", (req, res) => {
    if (!checkBearer(req, tokenStore)) return res.status(401).json({ error: "unauthorized" });
    const ok = tokenStore.revoke(req.params.id);
    if (!ok) return res.status(404).json({ error: "no such client" });
    res.json({ revoked: req.params.id });
  });
}

function checkBearer(req, tokenStore) {
  const auth = req.get("authorization") || "";
  const provided = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  return tokenStore.has(provided);
}

// Exposed for tests.
export function _resetSessionsForTest() {
  sessions.clear();
}
