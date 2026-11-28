import assert from "node:assert/strict";
import { test } from "node:test";
import { ApxClient } from "@apx/protocol/client";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";

const fix = { lat: 1, lon: 2, at: "2026-11-01T00:00:00Z" };

test("owner privacy revokes legacy phone location in flight without disconnecting its camera", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  let node: Awaited<ReturnType<ApxClient["connect"]>> | undefined;
  try {
    const { client, core } = env;
    const pairing = await client.call("devices.pair_start", {});
    const paired = await new ApxClient({ url: core.url }).call("devices.pair", {
      code: pairing.code,
      name: "Test phone",
      platform: "android",
    });
    const mobile = new ApxClient({ url: core.url, token: paired.token });
    node = await mobile.connect("node", ["location", "camera"]);
    const requested = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let calls = 0;
    node.onRequest(async (method) => {
      if (method === "phone.location") {
        calls++;
        requested.resolve();
        await release.promise;
        return fix;
      }
      return { mime: "image/jpeg", data: "/9j/4AAQSkZJRgAB/9k=" };
    });
    const pending = client.call("phone.location", {});
    const rejected = assert.rejects(pending, /permission changed/);
    await requested.promise;
    await mobile.call("phone.configure_privacy", { location: false });
    assert.equal((await client.call("phone.privacy", {})).location, false);
    await mobile.call("phone.configure_privacy", { location: true });
    release.resolve();
    await rejected;
    await client.call("phone.configure_privacy", { location: false });
    await assert.rejects(client.call("phone.location", {}), /turned off/);
    assert.equal(calls, 1, "a disabled call never reaches even a legacy APK");
    const photo = await client.call("phone.photo", {});
    assert.ok(photo.media.id, "location revocation does not revoke the camera");
    assert.equal((await client.call("devices.list", {})).devices.length, 1);
  } finally {
    node?.close();
    await env.core.close();
    await env.cleanup();
  }
});

test("trip location revocation rejects legacy positions and ends the trip without implicit restart", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  try {
    const { client, core } = env;
    const at = "2026-11-01T00:00:00Z";
    const trip_id = "privacy-trip";
    await client.call("car.configure", { enabled: true });
    await client.call("car.trip_start", { trip_id, source: "manual", at });
    assert.equal((await client.call("car.position", { trip_id, ...fix })).active, true);
    const before = core.store.carTrips.get(trip_id)?.position;
    await client.call("phone.configure_privacy", { trips: false });
    assert.equal((await client.call("car.position", { trip_id, lat: 3, lon: 4, at })).active, false);
    assert.deepEqual(core.store.carTrips.get(trip_id)?.position, before);
    assert.equal((await client.call("car.trip_start", { trip_id, source: "manual", at })).trip, undefined);
    await client.call("phone.configure_privacy", { trips: true });
    assert.equal((await client.call("car.settings", {})).settings.enabled, false);
    assert.equal((await client.call("car.trip", {})).trip, undefined);
    await client.call("car.configure", { enabled: true });
    assert.equal(
      (await client.call("car.trip_start", { trip_id, source: "manual", at })).trip,
      undefined,
      "a stale APK cannot reopen the trip revoked by the owner",
    );
    assert.equal(
      (await client.call("car.trip_start", { trip_id: "fresh-legacy", source: "manual", at })).trip,
      undefined,
    );
    const { trip_revision: consent_revision } = await client.call("phone.privacy", {});
    assert.equal(
      (await client.call("car.trip_start", { trip_id: "fresh-trip", source: "manual", at, consent_revision })).trip?.id,
      "fresh-trip",
    );
    assert.equal((await client.call("car.position", { trip_id: "fresh-trip", ...fix })).active, false);
    assert.equal((await client.call("car.position", { trip_id: "fresh-trip", ...fix, consent_revision })).active, true);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
