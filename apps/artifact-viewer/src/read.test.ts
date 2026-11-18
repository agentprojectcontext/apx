import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { createCopyReader, readPublicCopy } from "./read.ts";

function fixture(extra = {}) {
  const bundle = {
    format: "apx-artifact@1",
    manifest: { name: "orders", title: "Orders", kind: "widget", version: 1 },
    html: "<h1>Órdenes</h1>",
    state: { chosen: "open" },
    ...extra,
  };
  const json = JSON.stringify(bundle);
  const data = Buffer.from(json).toString("base64");
  const meta = {
    title: "Orders",
    chunk_count: 1,
    bytes: Buffer.byteLength(json),
    sha256: createHash("sha256").update(json).digest("hex"),
  };
  const read = async (path: string): Promise<unknown> => (path.endsWith("/parts/0") ? { data } : meta);
  return { bundle, json, data, meta, read };
}

test("a public copy is decoded losslessly and checked again before it can be shown or downloaded", async () => {
  const f = fixture();
  const calls: string[] = [];
  const copy = await readPublicCopy("abcd1234", async (path) => {
    calls.push(path);
    return f.read(path);
  });
  assert.equal(copy.json, f.json);
  assert.deepEqual(copy.bundle, f.bundle);
  assert.deepEqual(calls, ["publicArtifacts/abcd1234", "publicArtifacts/abcd1234/parts/0", "publicArtifacts/abcd1234"]);
});

test("listener metadata saves one read and verified parts are reused only with fresh server checks", async () => {
  const f = fixture();
  const calls: string[] = [];
  let revoked = false;
  let changed = false;
  const load = createCopyReader("abcd1234", async (path) => {
    calls.push(path);
    if (revoked) throw new Error("permission-denied");
    if (changed && !path.includes("/parts/")) return { ...f.meta, sha256: "0".repeat(64) };
    return f.read(path);
  });
  assert.equal((await load(f.meta)).json, f.json);
  assert.deepEqual(calls.splice(0), ["publicArtifacts/abcd1234/parts/0", "publicArtifacts/abcd1234"]);
  assert.equal((await load()).json, f.json);
  assert.deepEqual(calls.splice(0), ["publicArtifacts/abcd1234", "publicArtifacts/abcd1234"]);
  changed = true;
  await assert.rejects(load(), /invalid_public_copy/);
  changed = false;
  revoked = true;
  await assert.rejects(load(), /permission-denied/);
});

test("a new server snapshot fetches new parts and revalidates the final metadata", async () => {
  const first = fixture();
  const second = fixture({ html: "<h1>Updated</h1>" });
  let current = first;
  let partReads = 0;
  const load = createCopyReader("abcd1234", async (path) => {
    if (path.includes("/parts/")) partReads++;
    return current.read(path);
  });
  assert.equal((await load(first.meta)).json, first.json);
  current = second;
  assert.equal((await load(second.meta)).json, second.json);
  assert.equal(partReads, 2);
  await assert.rejects(load(first.meta), /invalid_public_copy/);
});

test("invalid codes, metadata, missing parts and wrong hashes fail closed", async () => {
  const f = fixture();
  await assert.rejects(readPublicCopy("../other", f.read), /invalid_public_code/);
  for (const change of [
    { chunk_count: 9 },
    { chunk_count: 0 },
    { bytes: 4_200_001 },
    { bytes: 0 },
    { sha256: "invalid" },
  ]) {
    await assert.rejects(
      readPublicCopy("abcd1234", async () => ({ ...f.meta, ...change })),
      /invalid_public_copy/,
    );
  }
  await assert.rejects(
    readPublicCopy("abcd1234", async (path) => (path.endsWith("/parts/0") ? undefined : f.meta)),
    /invalid_public_copy/,
  );
  await assert.rejects(
    readPublicCopy("abcd1234", async (path) => (path.endsWith("/parts/0") ? { data: "YQ==" } : f.meta)),
    /invalid_public_copy/,
  );
  await assert.rejects(
    readPublicCopy("abcd1234", async (path) =>
      path.endsWith("/parts/0") ? { data: f.data } : { ...f.meta, sha256: "0".repeat(64) },
    ),
    /invalid_public_copy/,
  );
});

test("a revoked or changed copy cannot reuse bytes fetched before the change", async () => {
  const f = fixture();
  let reads = 0;
  await assert.rejects(
    readPublicCopy("abcd1234", async (path) => {
      if (!path.includes("/parts/")) {
        reads++;
        if (reads === 2) throw new Error("permission-denied");
      }
      return f.read(path);
    }),
    /permission-denied/,
  );
  reads = 0;
  await assert.rejects(
    readPublicCopy("abcd1234", async (path) => {
      if (!path.includes("/parts/")) {
        reads++;
        if (reads === 2) return { ...f.meta, sha256: "0".repeat(64) };
      }
      return f.read(path);
    }),
    /public_copy_changed/,
  );
});

test("public downloads refuse private-memory and provenance fields even with an otherwise valid hash", async () => {
  for (const extra of [
    { db: "private" },
    { store: { key: "private" } },
    { manifest: { ...fixture().bundle.manifest, author: "Private author" } },
  ]) {
    const f = fixture(extra);
    await assert.rejects(readPublicCopy("abcd1234", f.read), /invalid_public_copy/);
  }
});
