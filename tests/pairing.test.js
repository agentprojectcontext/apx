// Tests for the QR pairing flow added on top of the multi-token store.
//
// We build a real Express app via buildApi() with an in-memory tokenStore,
// listen on an ephemeral port, then drive /pair/init → /pair/confirm →
// /deck/manifest with the freshly-issued client token.
//
// The token store is built fresh inside each test so persistence to
// ~/.apx/clients.json is sidestepped: createTokenStore() reads the file
// once on construction, but since we mutate APX_HOME via a temp env var
// the store ends up empty + writes go to a throwaway directory.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Point APX_HOME at a temp dir BEFORE importing anything that reads it.
const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-pairing-test-"));
process.env.HOME = TMP_HOME; // config.js derives APX_HOME from os.homedir()

const { ProjectManager } = await import("../src/host/daemon/db.js");
const { buildApi } = await import("../src/host/daemon/api.js");
const { createTokenStore, CLIENTS_PATH } = await import("../src/host/daemon/token-store.js");
const { _resetSessionsForTest } = await import("../src/host/daemon/api/pairing.js");

function resetClientsFile() {
  try { fs.unlinkSync(CLIENTS_PATH); } catch {}
}

async function listen(app) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

function buildHarness({ masterToken = "master-xyz" } = {}) {
  _resetSessionsForTest();
  resetClientsFile();
  const projects = new ProjectManager({});
  projects.registerDefault();
  const tokenStore = createTokenStore({ masterToken });
  const app = buildApi({
    projects,
    registries: null,
    plugins: { status: () => ({}), get: () => null },
    scheduler: null,
    version: "test",
    startedAt: Date.now(),
    addProjectGlobally: () => {},
    config: { host: "127.0.0.1", port: 7430 },
    token: masterToken,
    tokenStore,
  });
  return { app, tokenStore };
}

test("POST /pair/init mints a pairing_id with TTL and fingerprint", async () => {
  const { app, tokenStore } = buildHarness();
  const { server, baseUrl } = await listen(app);
  try {
    const res = await fetch(`${baseUrl}/pair/init`, { method: "POST" });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.match(body.pairing_id, /^[0-9a-f-]{36}$/i);
    assert.ok(body.ttl_ms > 0);
    assert.equal(body.fingerprint, tokenStore.masterFingerprint());
    assert.equal(body.daemon.port, 7430);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("POST /pair/confirm issues a usable token", async () => {
  const { app, tokenStore } = buildHarness();
  const { server, baseUrl } = await listen(app);
  try {
    const initRes = await fetch(`${baseUrl}/pair/init`, { method: "POST" });
    const init = await initRes.json();

    const confirmRes = await fetch(`${baseUrl}/pair/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        pairing_id: init.pairing_id,
        label: "Test Device",
        fingerprint: init.fingerprint,
      }),
    });
    assert.equal(confirmRes.status, 200);
    const confirm = await confirmRes.json();
    assert.ok(confirm.token && confirm.token.length >= 32);
    assert.equal(confirm.label, "Test Device");
    assert.equal(confirm.fingerprint_match, true);

    // Token can now reach an authenticated endpoint.
    const manifest = await fetch(`${baseUrl}/deck/manifest`, {
      headers: { authorization: `Bearer ${confirm.token}` },
    });
    assert.equal(manifest.status, 200);

    // Token store sees the new client.
    const clients = tokenStore.list();
    assert.equal(clients.length, 1);
    assert.equal(clients[0].label, "Test Device");
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("POST /pair/confirm rejects unknown pairing_id", async () => {
  const { app } = buildHarness();
  const { server, baseUrl } = await listen(app);
  try {
    const res = await fetch(`${baseUrl}/pair/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pairing_id: "00000000-0000-0000-0000-000000000000" }),
    });
    assert.equal(res.status, 404);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("POST /pair/confirm is one-shot", async () => {
  const { app } = buildHarness();
  const { server, baseUrl } = await listen(app);
  try {
    const init = await (await fetch(`${baseUrl}/pair/init`, { method: "POST" })).json();
    const ok = await fetch(`${baseUrl}/pair/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pairing_id: init.pairing_id, label: "A" }),
    });
    assert.equal(ok.status, 200);

    const dup = await fetch(`${baseUrl}/pair/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pairing_id: init.pairing_id, label: "A again" }),
    });
    assert.equal(dup.status, 409);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("GET /pair/status reports pending → confirmed", async () => {
  const { app } = buildHarness();
  const { server, baseUrl } = await listen(app);
  try {
    const init = await (await fetch(`${baseUrl}/pair/init`, { method: "POST" })).json();

    const pendingRes = await fetch(`${baseUrl}/pair/status/${init.pairing_id}`);
    const pending = await pendingRes.json();
    assert.equal(pending.status, "pending");

    await fetch(`${baseUrl}/pair/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pairing_id: init.pairing_id, label: "Phone" }),
    });

    const confirmedRes = await fetch(`${baseUrl}/pair/status/${init.pairing_id}`);
    const confirmed = await confirmedRes.json();
    assert.equal(confirmed.status, "confirmed");
    assert.equal(confirmed.device_label, "Phone");
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("auth middleware rejects unknown tokens but accepts paired ones", async () => {
  const { app } = buildHarness({ masterToken: "MASTER" });
  const { server, baseUrl } = await listen(app);
  try {
    // Unauthenticated request → 401
    const bad = await fetch(`${baseUrl}/deck/manifest`);
    assert.equal(bad.status, 401);

    // Master token still works.
    const m = await fetch(`${baseUrl}/deck/manifest`, {
      headers: { authorization: "Bearer MASTER" },
    });
    assert.equal(m.status, 200);

    // Pair, then the new token also works.
    const init = await (await fetch(`${baseUrl}/pair/init`, { method: "POST" })).json();
    const c = await (await fetch(`${baseUrl}/pair/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pairing_id: init.pairing_id }),
    })).json();

    const okClient = await fetch(`${baseUrl}/deck/manifest`, {
      headers: { authorization: `Bearer ${c.token}` },
    });
    assert.equal(okClient.status, 200);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("GET /pair/list and DELETE /pair/revoke require auth", async () => {
  const { app } = buildHarness({ masterToken: "MASTER" });
  const { server, baseUrl } = await listen(app);
  try {
    // Without auth header → 401.
    const noAuth = await fetch(`${baseUrl}/pair/list`);
    assert.equal(noAuth.status, 401);

    // Mint a client first.
    const init = await (await fetch(`${baseUrl}/pair/init`, { method: "POST" })).json();
    const c = await (await fetch(`${baseUrl}/pair/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pairing_id: init.pairing_id, label: "X" }),
    })).json();

    // List with master.
    const listRes = await fetch(`${baseUrl}/pair/list`, {
      headers: { authorization: "Bearer MASTER" },
    });
    const list = await listRes.json();
    assert.equal(list.clients.length, 1);
    assert.equal(list.clients[0].label, "X");

    // Revoke and confirm token stops working.
    const rev = await fetch(`${baseUrl}/pair/revoke/${list.clients[0].id}`, {
      method: "DELETE",
      headers: { authorization: "Bearer MASTER" },
    });
    assert.equal(rev.status, 200);

    const dead = await fetch(`${baseUrl}/deck/manifest`, {
      headers: { authorization: `Bearer ${c.token}` },
    });
    assert.equal(dead.status, 401);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
