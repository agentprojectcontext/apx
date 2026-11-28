import assert from "node:assert/strict";
import { test } from "node:test";
import { createBus } from "../bus.ts";
import { openDb } from "../db/db.ts";
import { createStore } from "../domain/store.ts";
import { tempDir } from "../testkit/platform.ts";
import { createCar, IDLE_TRIP_MS } from "./service.ts";

async function setup() {
  const dir = tempDir("apx-car-recovery-");
  const db = openDb(dir.path);
  const bus = createBus();
  const store = createStore(db, bus);
  let at = Date.parse("2026-11-27T15:00:00Z");
  const now = () => new Date(at);
  store.settings.write("car", { ...store.settings.read("car"), enabled: true });
  const make = () =>
    createCar({ store, bus, now, secrets: { resolve: () => undefined, has: () => false, set: () => {} } });
  const car = make();
  const device = store.devices.create("Acme phone", "android").device;
  const start = {
    trip_id: "trip-acme",
    source: "android_auto" as const,
    at: now().toISOString(),
    device_id: device.id,
  };
  const point = () => ({ trip_id: start.trip_id, lat: 1, lon: 2, at: now().toISOString() });
  car.tripStart(start);
  car.position(point());
  return {
    car,
    store,
    device,
    start,
    point,
    make,
    expire() {
      at += IDLE_TRIP_MS + 1;
      car.check.run(now());
      assert.equal(car.trip().trip, undefined);
    },
    async [Symbol.asyncDispose]() {
      db.close();
      await dir.remove();
    },
  };
}

test("an authorized phone resumes after idle expiry and a core restart without losing its trip", async () => {
  await using env = await setup();
  env.expire();
  const restarted = env.make();
  assert.equal(restarted.position(env.point()).active, true);
  assert.equal(restarted.trip().trip?.id, env.start.trip_id);
  assert.equal(restarted.trip().trip?.started_at, env.start.at);
  await restarted.idle();
});

test("an idle trip cannot recover after the phone was disabled and enabled again", async () => {
  await using env = await setup();
  env.expire();
  env.car.phone({ enabled: false, device_id: env.device.id }, undefined);
  env.car.phone({ enabled: true }, env.device.id);
  assert.equal(env.car.position(env.point()).active, false);
  assert.equal(env.car.tripStart(env.start).trip, undefined);
  assert.equal(env.car.tripStart({ ...env.start, trip_id: "new-trip" }).trip?.id, "new-trip");
});

test("global revocation while idle cannot be undone by reconnecting an old trip", async () => {
  await using env = await setup();
  env.expire();
  env.car.configure({ enabled: false });
  env.car.configure({ enabled: true });
  assert.equal(env.car.position(env.point()).active, false);
  assert.equal(env.car.tripStart(env.start).trip, undefined);
});

test("an idle trip cannot replace another phone's active trip or resume after explicit trip end", async () => {
  await using env = await setup();
  env.expire();
  const other = env.store.devices.create("Northwind phone", "android").device;
  env.car.tripStart({ ...env.start, trip_id: "other-trip", device_id: other.id });
  assert.equal(env.car.position(env.point()).active, false);
  assert.equal(env.car.tripStart(env.start).trip, undefined);
  assert.equal(env.car.trip().trip?.id, "other-trip");
  env.car.tripEnd("other-trip", env.point().at);
  env.car.tripEnd(env.start.trip_id, env.point().at);
  assert.equal(env.car.position(env.point()).active, false);
});

for (const idle of [false, true]) {
  test(`explicit trip end prevents reannouncement${idle ? " after idle expiry" : ""}`, async () => {
    await using env = await setup();
    if (idle) env.expire();
    env.car.tripEnd(env.start.trip_id, env.point().at);
    const restarted = env.make();
    assert.equal(restarted.tripStart(env.start).trip, undefined);
    assert.equal(restarted.position(env.point()).active, false);
    assert.equal(restarted.tripStart({ ...env.start, trip_id: "new-trip" }).trip?.id, "new-trip");
    await restarted.idle();
  });
}

test("reannouncing an idle trip preserves phone identity", async () => {
  await using env = await setup();
  env.expire();
  const other = env.store.devices.create("Northwind phone", "android").device;
  assert.equal(env.car.tripStart({ ...env.start, device_id: other.id }).trip, undefined);
  assert.equal(env.car.tripStart(env.start).trip?.id, env.start.trip_id);
});
