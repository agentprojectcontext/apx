import assert from "node:assert/strict";
import { test } from "node:test";
import { ApxClient } from "@apx/protocol/client";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";

test("a previously displaced trip cannot use a new consent to reopen or replace its destination", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  try {
    const { client, core } = env;
    const at = "2026-11-01T00:00:00Z";
    await client.call("car.configure", { enabled: true });
    await client.call("car.trip_start", {
      trip_id: "previous-trip",
      source: "manual",
      at,
      destination: { label: "Original" },
    });
    await client.call("car.trip_start", { trip_id: "current-trip", source: "manual", at });
    await client.call("car.configure", { enabled: false });
    await client.call("car.configure", { enabled: true });
    const { trip_revision: consent_revision } = await client.call("phone.privacy", {});
    for (const revision of [undefined, "initial", consent_revision]) {
      const result = await client.call("car.trip_start", {
        trip_id: "previous-trip",
        source: "maps",
        at,
        destination: { label: "Must not be stored" },
        ...(revision ? { consent_revision: revision } : {}),
      });
      assert.equal(result.trip, undefined);
      assert.equal(core.store.carTrips.get("previous-trip")?.destination?.label, "Original");
    }
    assert.equal(
      (await client.call("car.position", { trip_id: "previous-trip", lat: 3, lon: 4, at, consent_revision })).active,
      false,
    );
    assert.equal(core.store.carTrips.get("previous-trip")?.position, undefined);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

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
