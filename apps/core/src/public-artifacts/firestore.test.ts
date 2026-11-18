import assert from "node:assert/strict";
import { test } from "node:test";
import { publicArtifactCopy } from "../domain/public-artifact-copy.ts";
import { createPublicArtifactCloud } from "./firestore.ts";

const copy = publicArtifactCopy(
  { name: "orders", title: "Orders", html: "<h1>Orders</h1>", version: 1, app: true },
  [],
);

test("an invalidated account cannot start any publication request", async () => {
  let calls = 0;
  const cloud = createPublicArtifactCloud({
    project: "demo-apx-artifacts",
    fetch: async () => {
      calls++;
      return Response.json({});
    },
  });
  const session = { uid: "person", idToken: "test-token", current: () => false };
  for (const run of [
    () => cloud.slots(session),
    () => cloud.inspect(session, "abcd1234"),
    () => cloud.publish(session, "abcd1234", copy),
    () => cloud.update(session, "abcd1234", copy, "revision"),
    () => cloud.revoke(session, "abcd1234", "revision"),
  ]) {
    await assert.rejects(run(), /public_artifact_account_changed/);
  }
  assert.equal(calls, 0);
});

test("sign-out while reading free slots prevents the subsequent publication write", async () => {
  let active = true;
  let reads = 0;
  let writes = 0;
  const cloud = createPublicArtifactCloud({
    project: "demo-apx-artifacts",
    fetch: async (_input, init) => {
      if (init?.method === "POST") writes++;
      else reads++;
      active = false;
      return Response.json({ documents: [] });
    },
  });
  const session = { uid: "person", idToken: "test-token", current: () => active };
  await assert.rejects(cloud.publish(session, "abcd1234", copy), /public_artifact_account_changed/);
  assert.equal(reads, 1);
  assert.equal(writes, 0);
});
