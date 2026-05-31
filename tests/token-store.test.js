// Tests for the multi-token store (master + paired client tokens).
//
// token-store persists to ~/.apx/clients.json. We redirect APX_HOME at a temp
// dir by setting $HOME BEFORE importing anything that reads it (config.js
// derives APX_HOME from os.homedir()), so writes never touch the real file.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-token-store-test-"));
process.env.HOME = TMP_HOME;

const { createTokenStore, fingerprintToken, CLIENTS_PATH } = await import(
  "../src/host/daemon/token-store.js"
);

function reset() {
  try { fs.unlinkSync(CLIENTS_PATH); } catch {}
}

test("fingerprintToken is a deterministic 16-hex-char digest", () => {
  const fp = fingerprintToken("master-abc");
  assert.match(fp, /^[0-9a-f]{16}$/);
  assert.equal(fp, fingerprintToken("master-abc"));
  assert.notEqual(fp, fingerprintToken("master-xyz"));
});

test("has() accepts the master token and rejects unknown/empty tokens", () => {
  reset();
  const store = createTokenStore({ masterToken: "master-1" });
  assert.equal(store.has("master-1"), true);
  assert.equal(store.has("nope"), false);
  assert.equal(store.has(""), false);
  assert.equal(store.has(null), false);
  assert.equal(store.has(undefined), false);
});

test("masterFingerprint() matches fingerprintToken(master) and is '' without a master", () => {
  reset();
  assert.equal(
    createTokenStore({ masterToken: "m" }).masterFingerprint(),
    fingerprintToken("m")
  );
  assert.equal(createTokenStore({}).masterFingerprint(), "");
});

test("addClient() issues a 64-hex token, accepts it, and persists to disk", () => {
  reset();
  const store = createTokenStore({ masterToken: "master-2" });
  const entry = store.addClient("Pixel 7", "android");

  assert.match(entry.token, /^[0-9a-f]{64}$/);
  assert.ok(entry.id);
  assert.equal(entry.label, "Pixel 7");
  assert.equal(entry.kind, "android");
  assert.equal(entry.last_seen, null);
  assert.equal(store.has(entry.token), true);

  // Persisted to clients.json with the token intact.
  const onDisk = JSON.parse(fs.readFileSync(CLIENTS_PATH, "utf8"));
  assert.equal(onDisk.length, 1);
  assert.equal(onDisk[0].token, entry.token);
});

test("a fresh store reads previously-persisted client tokens", () => {
  reset();
  const a = createTokenStore({ masterToken: "master-3" });
  const entry = a.addClient("Laptop");

  const b = createTokenStore({ masterToken: "master-3" });
  assert.equal(b.has(entry.token), true);
});

test("list() redacts tokens to the last 8 chars and defaults kind to 'device'", () => {
  reset();
  const store = createTokenStore({});
  const entry = store.addClient("Tablet"); // no kind
  const listed = store.list();

  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, entry.id);
  assert.equal(listed[0].label, "Tablet");
  assert.equal(listed[0].kind, "device");
  assert.equal(listed[0].token_suffix, entry.token.slice(-8));
  assert.ok(!("token" in listed[0]), "full token must not be exposed by list()");
});

test("touch() records last_seen for a known token and no-ops for unknown", () => {
  reset();
  const store = createTokenStore({});
  const entry = store.addClient("Phone");
  assert.equal(store.list()[0].last_seen, null);

  store.touch(entry.token);
  assert.ok(store.list()[0].last_seen, "last_seen should be set after touch");

  assert.doesNotThrow(() => store.touch("unknown-token"));
});

test("revoke() removes a client by id and invalidates its token", () => {
  reset();
  const store = createTokenStore({ masterToken: "master-4" });
  const entry = store.addClient("Throwaway");
  assert.equal(store.has(entry.token), true);

  assert.equal(store.revoke(entry.id), true);
  assert.equal(store.has(entry.token), false);
  assert.equal(store.list().length, 0);
  // Master token still works after a client is revoked.
  assert.equal(store.has("master-4"), true);

  // Revoking an unknown id is a no-op returning false.
  assert.equal(store.revoke("does-not-exist"), false);
});
