import assert from "node:assert/strict";
import { test } from "node:test";
import { publicArtifactCopy } from "../domain/public-artifact-copy.ts";
import { readPublishedArtifact } from "./read.ts";
import { artifactWrites } from "./writes.ts";

test("anonymous handoff reads the approved bytes, checks revocation again and never forwards account credentials", async () => {
  const copy = publicArtifactCopy(
    {
      name: "orders",
      title: "Orders",
      html: "<h1>Orders</h1>",
      version: 1,
      app: true,
      state: { chosen: 1, private: 2 },
    },
    ["chosen"],
  );
  const documents = "projects/demo-apx-artifacts/databases/(default)/documents";
  const writes = artifactWrites(documents, "0123abcd", copy) as { update: { name: string; fields: unknown } }[];
  let reads = 0;
  let revoked = false;
  const fake: typeof fetch = async (input, init) => {
    assert.equal(new Headers(init?.headers).get("authorization"), null);
    assert.equal(init?.redirect, "error");
    const url = new URL(String(input));
    assert.equal(url.origin, "https://firestore.googleapis.com");
    const doc = writes.find((write) => `/v1/${write.update.name}` === url.pathname)?.update;
    if (url.pathname.endsWith("/0123abcd")) {
      reads++;
      if (revoked && reads % 2 === 0) return new Response("{}", { status: 404 });
    }
    return new Response(JSON.stringify(doc), { status: doc ? 200 : 404 });
  };
  assert.deepEqual(
    await readPublishedArtifact("0123abcd", { project: "demo-apx-artifacts", fetch: fake }),
    copy.bundle,
  );
  assert.equal(reads, 2);
  revoked = true;
  await assert.rejects(
    readPublishedArtifact("0123abcd", { project: "demo-apx-artifacts", fetch: fake }),
    /public_artifact_missing/,
  );
  await assert.rejects(
    readPublishedArtifact("../../private", { project: "demo-apx-artifacts", fetch: fake }),
    /invalid_public_code/,
  );
  assert.equal(reads, 4);
});

test("handoff rejects oversized response bodies before parsing", async () => {
  await assert.rejects(
    readPublishedArtifact("0123abcd", {
      project: "demo-apx-artifacts",
      fetch: async () => new Response("x".repeat(800_001)),
    }),
    /public_artifact_too_large/,
  );
});
