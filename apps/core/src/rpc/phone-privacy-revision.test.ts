import assert from "node:assert/strict";
import { test } from "node:test";
import { ApxClient } from "@apx/protocol/client";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";

test("remote trip revocations survive reenable and do not conflate requested location with trip consent", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  try {
    const { client, core } = env;
    const original = await client.call("phone.privacy", {});
    await client.call("car.configure", { enabled: true });
    await client.call("car.configure", { enabled: false });
    const revoked = await client.call("phone.privacy", {});
    assert.notEqual(revoked.trip_revision, original.trip_revision);
    await client.call("car.configure", { enabled: true });
    assert.equal((await client.call("phone.privacy", {})).trip_revision, revoked.trip_revision);
    await client.call("phone.configure_privacy", { location: false });
    assert.equal((await client.call("phone.privacy", {})).trip_revision, revoked.trip_revision);
    await client.call("phone.configure_privacy", { trips: false });
    const next = await client.call("phone.privacy", {});
    assert.notEqual(next.trip_revision, revoked.trip_revision);
    assert.equal(next.location, false);
    await client.call("phone.configure_privacy", { trips: true });
    assert.equal((await client.call("phone.privacy", {})).trip_revision, next.trip_revision);
    const agent = new ApxClient({ url: core.url, actor: "agent" });
    await assert.rejects(agent.call("phone.configure_privacy", { location: true }), /reserved to the owner/);
    assert.equal((await client.call("phone.privacy", {})).location, false);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
