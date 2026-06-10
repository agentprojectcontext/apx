// Multi-token store for the APX daemon.
//
// Background: the daemon historically had a single master token at
// ~/.apx/daemon.token. That works fine for the local CLI but breaks down
// once we want to pair multiple companion clients (Deck app, future
// browser overlay, etc.) without leaking the master token over QR.
//
// Each paired client gets its own opaque token persisted in
// ~/.apx/clients.json:
//   [
//     { "id": "<uuid>", "token": "<64-hex>", "label": "Pixel 7",
//       "created_at": "2026-05-27T15:30:00Z", "last_seen": "...|null" }
//   ]
//
// Auth middleware accepts ANY token in the store (master + clients). The
// store also fingerprints the master token so the pairing QR can prove
// "this daemon" cryptographically (defends against trivial DNS rebinding
// onto the LAN port).
//
// All persistence is best-effort with mode 0o600 — same threat model as
// daemon.token.

import fs from "node:fs";
import path from "node:path";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { APX_HOME } from "../../core/config/index.js";

export const CLIENTS_PATH = path.join(APX_HOME, "clients.json");

function readClientsFile() {
  try {
    const raw = fs.readFileSync(CLIENTS_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeClientsFile(clients) {
  fs.mkdirSync(APX_HOME, { recursive: true });
  const tmp = `${CLIENTS_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(clients, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(tmp, CLIENTS_PATH);
}

export function fingerprintToken(token) {
  return createHash("sha256").update(String(token)).digest("hex").slice(0, 16);
}

export function createTokenStore({ masterToken } = {}) {
  const clients = readClientsFile();
  const valid = new Set(clients.map((c) => c.token));
  if (masterToken) valid.add(masterToken);

  return {
    /** Returns true iff `token` is the master or a known client token. */
    has(token) {
      if (!token) return false;
      return valid.has(String(token));
    },

    /** Master token fingerprint — embedded in QR so the app can confirm
     *  it's pairing with the same daemon it scanned (vs. someone else
     *  serving on the same port). 16 hex chars = 64 bits, enough for a
     *  "did we scan the right one" check. */
    masterFingerprint() {
      return masterToken ? fingerprintToken(masterToken) : "";
    },

    /** Create a new client token, persist it, return the public record
     *  (id + token; caller decides how to surface it). */
    addClient(label = "", kind = "") {
      const entry = {
        id: randomUUID(),
        token: randomBytes(32).toString("hex"),
        label: String(label || "").slice(0, 64) || "device",
        kind: String(kind || "").slice(0, 16) || "device",
        created_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
        last_seen: null,
      };
      clients.push(entry);
      valid.add(entry.token);
      writeClientsFile(clients);
      return entry;
    },

    /** Mark a client token as just-used. Best-effort, never throws. */
    touch(token) {
      const c = clients.find((x) => x.token === token);
      if (!c) return;
      c.last_seen = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
      try { writeClientsFile(clients); } catch {}
    },

    /** Public listing (token redacted to last 8 hex chars). */
    list() {
      return clients.map((c) => ({
        id: c.id,
        label: c.label,
        kind: c.kind || "device",
        created_at: c.created_at,
        last_seen: c.last_seen,
        token_suffix: c.token.slice(-8),
      }));
    },

    /** Remove a client by id. Returns true if something was removed. */
    revoke(id) {
      const idx = clients.findIndex((c) => c.id === id);
      if (idx < 0) return false;
      const [removed] = clients.splice(idx, 1);
      valid.delete(removed.token);
      writeClientsFile(clients);
      return true;
    },
  };
}
