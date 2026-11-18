import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { publicArtifactCopy } from "../domain/public-artifact-copy.ts";
import { tempDir } from "../testkit/platform.ts";
import type { PublicationDraftSnapshot } from "./drafts.ts";
import { publicationDraftPersistence } from "./persistence.ts";

function fixture(home: string) {
  let raw: string | undefined;
  let fail = false;
  const settings = {
    get: () => raw,
    set: (_key: string, value: string) => {
      if (fail) throw new Error("Storage unavailable");
      raw = value;
    },
  };
  return {
    store: publicationDraftPersistence(settings, home),
    raw: () => raw ?? "",
    seed: (value: string) => {
      raw = value;
    },
    fail: (value: boolean) => {
      fail = value;
    },
  };
}
function draft(payload = "open"): PublicationDraftSnapshot {
  return {
    id: randomUUID(),
    uid: "person",
    expires: 100_000,
    action: "publish",
    code: "abcd1234",
    title: "Orders",
    keys: ["chosen"],
    copy: publicArtifactCopy(
      { name: "orders", title: "Orders", html: "<h1>Orders</h1>", version: 1, app: false, state: { chosen: payload } },
      ["chosen"],
    ),
  };
}

test("twenty large snapshots live outside settings, are reused without rewrites, and are pruned after metadata commits", async () => {
  await using home = tempDir();
  const f = fixture(home.path);
  const first = draft("x".repeat(4_200_000 - (draft("").copy?.bytes ?? 0)));
  assert.equal(first.copy?.bytes, 4_200_000);
  const drafts = Array.from({ length: 20 }, () => ({ ...first, id: randomUUID() }));
  f.store.save(drafts);
  assert.ok(f.raw().length < 20_000);
  assert.doesNotMatch(f.raw(), /"json"|<h1>|xxxxx/);
  const dir = path.join(home.path, "public-artifact-drafts");
  assert.equal(fs.readdirSync(dir).length, 20);
  const file = path.join(dir, `${drafts[0]?.id}-${first.copy?.sha256}.json`);
  fs.utimesSync(file, 1, 1);
  f.store.save(drafts);
  assert.equal(fs.statSync(file).mtimeMs, 1000);
  const restored = f.store.load();
  assert.equal(restored.length, 20);
  assert.ok(restored.every((item) => item.copy?.json === first.copy?.json));
  if (process.platform !== "win32") {
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
  }
  f.store.save(drafts.slice(0, 1));
  assert.equal(fs.readdirSync(dir).length, 1);
  assert.equal(f.store.load().length, 1);
});

test("a failed metadata commit keeps the prior immutable snapshot and the next save removes orphan bytes", async () => {
  await using home = tempDir();
  const f = fixture(home.path);
  const old = draft();
  f.store.save([old]);
  f.fail(true);
  assert.throws(() => f.store.save([draft("new selection")]), /Storage unavailable/);
  assert.deepEqual(f.store.load(), [old]);
  assert.equal(fs.readdirSync(path.join(home.path, "public-artifact-drafts")).length, 1);
  f.fail(false);
  f.store.save([old]);
  assert.equal(fs.readdirSync(path.join(home.path, "public-artifact-drafts")).length, 1);
});

test("inline snapshots move once without losing cards, and failed migration preserves the prior row", async () => {
  await using home = tempDir();
  const f = fixture(home.path);
  const old = draft();
  const { bundle: _bundle, ...copy } = old.copy ?? {};
  const inline = JSON.stringify([{ ...old, copy }]);
  f.seed(inline);
  f.fail(true);
  assert.deepEqual(f.store.load(), [old]);
  assert.equal(f.raw(), inline);
  f.fail(false);
  assert.deepEqual(f.store.load(), [old]);
  assert.doesNotMatch(f.raw(), /"json"|<h1>/);
  assert.deepEqual(f.store.load(), [old]);
});

test("invalid snapshot identities cannot escape the private folder", async () => {
  await using home = tempDir();
  const f = fixture(home.path);
  const old = draft();
  f.seed(JSON.stringify([{ ...old, id: "../outside", copy: { bytes: old.copy?.bytes, sha256: old.copy?.sha256 } }]));
  assert.deepEqual(f.store.load(), []);
  assert.equal(fs.existsSync(path.join(home.path, "public-artifact-drafts")), false);
});

test("a corrupt or missing snapshot fails closed without discarding other valid cards; empty revocation titles persist", async () => {
  await using home = tempDir();
  const f = fixture(home.path);
  const bad = draft();
  const good = draft("chosen");
  f.store.save([bad, good]);
  const dir = path.join(home.path, "public-artifact-drafts");
  const file = path.join(dir, `${bad.id}-${bad.copy?.sha256}.json`);
  fs.writeFileSync(file, "x".repeat(bad.copy?.bytes ?? 0));
  assert.deepEqual(f.store.load(), [good]);
  fs.unlinkSync(file);
  assert.deepEqual(f.store.load(), [good]);
  const revoked = {
    ...good,
    action: "revoke" as const,
    title: "",
    copy: undefined,
    keys: [],
    done: { action: "revoke" as const, code: good.code, url: `https://artifact.apxagent.app/${good.code}` },
  };
  f.store.save([revoked]);
  assert.deepEqual(f.store.load(), [revoked]);
  assert.equal(fs.readdirSync(dir).length, 0);
});
