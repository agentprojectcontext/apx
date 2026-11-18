import assert from "node:assert/strict";
import { test } from "node:test";
import { publicArtifactCopy } from "../domain/public-artifact-copy.ts";
import { createPublicArtifactCloud } from "./cloud.ts";
import { publicationTransport } from "./test-cloud.ts";

const copy = publicArtifactCopy({ name: "orders", title: "Orders", html: "<h1>Orders</h1>", version: 1, app: true });
const session = { uid: "person", idToken: "test-token" };

test("the core sends approved bytes only to the Worker and never writes content to Firebase", async () => {
  const remote = publicationTransport();
  const calls: string[] = [];
  const cloud = createPublicArtifactCloud({
    fetch: async (input, init) => {
      const url = new URL(String(input));
      assert.equal(url.origin, "https://artifact.apxagent.app");
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-token");
      assert.equal(init?.redirect, "error");
      calls.push(`${init?.method} ${url.pathname}`);
      if (init?.method === "POST" && !url.pathname.endsWith("/revoke")) assert.equal(init.body, copy.json);
      return remote.fetch(input, init);
    },
  });
  assert.equal(await cloud.available(session, "abcd1234"), true);
  assert.deepEqual(await cloud.publish(session, "abcd1234", copy), { code: "abcd1234", sha256: copy.sha256 });
  assert.equal(await cloud.available(session, "abcd1234"), false);
  assert.equal((await cloud.slots(session)).length, 1);
  const current = await cloud.inspect(session, "abcd1234");
  assert.deepEqual(await cloud.revoke(session, "abcd1234", current.updateTime), { ok: true });
  assert.equal((await cloud.slots(session)).length, 0);
  assert.equal(calls.filter((call) => call.startsWith("POST ")).length, 2);
});

test("an invalidated account cannot issue reads or writes, including recovery reads", async () => {
  let calls = 0;
  const cloud = createPublicArtifactCloud({
    fetch: async () => {
      calls++;
      return Response.json({});
    },
  });
  const invalid = { ...session, current: () => false };
  for (const run of [
    () => cloud.available(invalid, "abcd1234"),
    () => cloud.slots(invalid),
    () => cloud.inspect(invalid, "abcd1234"),
    () => cloud.publish(invalid, "abcd1234", copy),
    () => cloud.update(invalid, "abcd1234", copy, "one"),
    () => cloud.revoke(invalid, "abcd1234", "one"),
  ])
    await assert.rejects(run(), /public_artifact_account_changed/);
  assert.equal(calls, 0);
});

test("lost mutation responses reconcile against R2 state; actual edge failures still fail", async () => {
  const remote = publicationTransport();
  let drop = false;
  const cloud = createPublicArtifactCloud({
    fetch: async (input, init) => {
      const result = await remote.fetch(input, init);
      if (init?.method === "POST" && drop) {
        drop = false;
        throw new Error("response lost after write");
      }
      return result;
    },
  });
  drop = true;
  assert.deepEqual(await cloud.publish(session, "abcd1234", copy), { code: "abcd1234", sha256: copy.sha256 });
  const current = await cloud.inspect(session, "abcd1234");
  const next = publicArtifactCopy({ ...copy.bundle.manifest, html: "<h1>Updated</h1>", app: true });
  drop = true;
  assert.deepEqual(await cloud.update(session, "abcd1234", next, current.updateTime), {
    code: "abcd1234",
    sha256: next.sha256,
  });
  const updated = await cloud.inspect(session, "abcd1234");
  drop = true;
  assert.deepEqual(await cloud.revoke(session, "abcd1234", updated.updateTime), { ok: true });
  assert.equal(remote.commits(), 3);
  const unavailable = createPublicArtifactCloud({
    fetch: async () => Response.json({ error: "public_artifact_unavailable" }, { status: 503 }),
  });
  await assert.rejects(unavailable.publish(session, "abcd1234", copy), /public_artifact_unavailable/);
  await assert.rejects(unavailable.revoke(session, "abcd1234", "one"), /public_artifact_unavailable/);
});

test("an outage is not an available code, and malformed or oversized private lists fail closed", async () => {
  const occupied = createPublicArtifactCloud({ fetch: async () => Response.json({ available: false }) });
  assert.equal(await occupied.available(session, "abcd1234"), false);
  const offline = createPublicArtifactCloud({ fetch: async () => Response.json({}, { status: 503 }) });
  await assert.rejects(offline.available(session, "abcd1234"), /public_artifact_unavailable/);
  for (const result of [{}, { documents: "wrong" }, { documents: Array.from({ length: 21 }, () => ({})) }])
    await assert.rejects(
      createPublicArtifactCloud({ fetch: async () => Response.json(result) }).slots(session),
      /public_artifact_unavailable/,
    );
});
