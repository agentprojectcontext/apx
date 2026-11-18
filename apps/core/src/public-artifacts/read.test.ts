import assert from "node:assert/strict";
import { test } from "node:test";
import { publicArtifactCopy } from "../domain/public-artifact-copy.ts";
import { readPublishedArtifact } from "./read.ts";

const copy = publicArtifactCopy(
  { name: "orders", title: "Orders", html: "<h1>Orders</h1>", version: 1, app: true, state: { chosen: 1, private: 2 } },
  ["chosen"],
);

test("anonymous handoff uses only the edge, validates exact bytes and rechecks revocation without account credentials", async () => {
  let reads = 0;
  let revoked = false;
  const fake: typeof fetch = async (input, init) => {
    assert.equal(new Headers(init?.headers).get("authorization"), null);
    assert.equal(init?.credentials, "omit");
    assert.equal(init?.redirect, "error");
    const url = new URL(String(input));
    assert.equal(url.origin, "https://artifact.apxagent.app");
    if (url.pathname.endsWith("/meta")) {
      reads++;
      if (revoked && reads % 2 === 0) return Response.json({}, { status: 404 });
      return Response.json({
        bytes: copy.bytes,
        title: copy.bundle.manifest.title,
        sha256: copy.sha256,
        revision: "one",
      });
    }
    return new Response(copy.json);
  };
  assert.deepEqual(await readPublishedArtifact("0123abcd", { fetch: fake }), copy.bundle);
  assert.equal(reads, 2);
  revoked = true;
  await assert.rejects(readPublishedArtifact("0123abcd", { fetch: fake }), /public_artifact_missing/);
  await assert.rejects(readPublishedArtifact("../../private", { fetch: fake }), /invalid_public_code/);
  assert.equal(reads, 4);
});

test("handoff rejects oversized metadata, bodies and a copy that changes during the download", async () => {
  await assert.rejects(
    readPublishedArtifact("0123abcd", { fetch: async () => new Response("x".repeat(4097)) }),
    /public_artifact_too_large/,
  );
  const meta = { title: copy.bundle.manifest.title, bytes: copy.bytes, sha256: copy.sha256, revision: "one" };
  await assert.rejects(
    readPublishedArtifact("0123abcd", {
      fetch: async (url) =>
        String(url).endsWith("/meta") ? Response.json(meta) : new Response("x".repeat(10_000_001)),
    }),
    /public_artifact_too_large/,
  );
  let reads = 0;
  await assert.rejects(
    readPublishedArtifact("0123abcd", {
      fetch: async (url) =>
        String(url).endsWith("/meta") ? Response.json({ ...meta, revision: String(++reads) }) : new Response(copy.json),
    }),
    /public_copy_changed/,
  );
});
