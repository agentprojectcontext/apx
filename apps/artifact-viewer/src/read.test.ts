import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { readEdgePublicCopy, verifyPublicCopy } from "@apx/protocol/public-copy";

function fixture(change: Record<string, unknown> = {}) {
  const bundle = {
    format: "apx-artifact@1",
    manifest: { name: "orders", title: "Orders", kind: "app", version: 1 },
    html: "<h1>Orders</h1>",
    state: { chosen: 1 },
    ...change,
  };
  const json = JSON.stringify(bundle);
  const meta = {
    title: "Orders",
    bytes: Buffer.byteLength(json),
    sha256: createHash("sha256").update(json).digest("hex"),
    revision: "one",
  };
  return { bundle, json, meta };
}

test("edge downloads validate exact UTF-8 bytes and metadata twice without reading Firebase or forwarding credentials", async () => {
  const f = fixture();
  const calls: string[] = [];
  const copy = await readEdgePublicCopy("abcd1234", {
    fetch: async (url, init) => {
      const path = new URL(String(url));
      assert.equal(path.origin, "https://artifact.apxagent.app");
      assert.equal(init?.credentials, "omit");
      assert.equal(init?.redirect, "error");
      assert.equal(new Headers(init?.headers).get("authorization"), null);
      calls.push(path.pathname);
      return path.pathname.endsWith("/meta") ? Response.json(f.meta) : new Response(f.json);
    },
  });
  assert.deepEqual(copy.bundle, f.bundle);
  assert.equal(copy.json, f.json);
  assert.deepEqual(calls, ["/api/copies/abcd1234/meta", "/api/copies/abcd1234/bundle", "/api/copies/abcd1234/meta"]);
});

test("invalid metadata, byte counts, hashes and content are rejected rather than cached or installed", async () => {
  const f = fixture({ html: "<h1>Plané</h1>" });
  assert.deepEqual((await verifyPublicCopy(f.json, f.meta)).bundle, f.bundle);
  for (const change of [
    { title: "" },
    { title: "x".repeat(121) },
    { bytes: 0 },
    { bytes: 10_000_001 },
    { bytes: f.meta.bytes - 1 },
    { sha256: "invalid" },
    { sha256: "0".repeat(64) },
  ])
    await assert.rejects(verifyPublicCopy(f.json, { ...f.meta, ...change }), /invalid_public_copy/);
  await assert.rejects(verifyPublicCopy(f.json.slice(0, -1), f.meta), /invalid_public_copy/);
  await assert.rejects(readEdgePublicCopy("../other"), /invalid_public_code/);
});

test("unknown memory and provenance fields cannot enter public copies", async () => {
  for (const change of [
    { store: { hidden: "private" } },
    { db: "private" },
    { secret: "private" },
    { manifest: { name: "orders", title: "Orders", kind: "app", version: 1, connect: ["https://example.com"] } },
    { manifest: { name: "orders", title: "Orders", kind: "app", version: 1, author: "Acme" } },
  ]) {
    const f = fixture(change);
    await assert.rejects(verifyPublicCopy(f.json, f.meta), /invalid_public_copy/);
  }
});

test("revocation and concurrent changes invalidate a download before returning a usable bundle", async () => {
  const f = fixture();
  let reads = 0;
  await assert.rejects(
    readEdgePublicCopy("abcd1234", {
      fetch: async (url) => {
        if (String(url).endsWith("/bundle")) return new Response(f.json);
        return ++reads === 1 ? Response.json(f.meta) : Response.json({}, { status: 404 });
      },
    }),
    /public_artifact_missing/,
  );
  reads = 0;
  await assert.rejects(
    readEdgePublicCopy("abcd1234", {
      fetch: async (url) =>
        String(url).endsWith("/bundle")
          ? new Response(f.json)
          : Response.json({ ...f.meta, revision: String(++reads) }),
    }),
    /public_copy_changed/,
  );
  await assert.rejects(
    readEdgePublicCopy("abcd1234", { fetch: async () => new Response(null, { status: 503 }) }),
    /public_artifact_unavailable/,
  );
});
