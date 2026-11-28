import assert from "node:assert/strict";
import { test } from "node:test";
import type { CoreEvent, ErrandCategory, ErrandPlace } from "@apx/protocol";
import { createBus } from "../bus.ts";
import { openDb } from "../db/db.ts";
import { createStore, type Store } from "../domain/store.ts";
import { tempDir } from "../testkit/platform.ts";
import type { FoundPlace, PlaceProvider } from "./provider.ts";
import { type Car, createCar, IDLE_TRIP_MS } from "./service.ts";

const HERE = { lat: -34.6, lon: -58.4 };
const START = Date.parse("2026-11-27T15:00:00.000Z");
const north = (m: number) => ({ lat: HERE.lat + m / 111_195, lon: HERE.lon });
const TRIP = "trip-0001-acme";

function fakePlaces(places: FoundPlace[]) {
  const calls: ErrandCategory[][] = [];
  let failing = false;
  const provider: PlaceProvider = {
    id: "osm",
    async search(_area, categories) {
      calls.push([...categories]);
      if (failing) throw new Error("Overpass is down");
      return places.filter((p) => p.categories.some((c) => categories.includes(c)));
    },
  };
  return { provider, calls, fail: (v: boolean) => (failing = v) };
}

const shop = (key: string, metres: number, category: ErrandCategory): FoundPlace => ({
  key: `osm:node/${key}`,
  name: key,
  ...north(metres),
  source: "osm",
  categories: [category],
});

const PLACES = [
  shop("Acme Market", 500, "supermarket"),
  shop("Northwind Foods", 900, "supermarket"),
  shop("Acme Papelera", 700, "stationery"),
];

async function setup(places = PLACES) {
  const dir = tempDir("apx-car-");
  const db = openDb(dir.path);
  const bus = createBus();
  const events: CoreEvent[] = [];
  bus.on((e) => {
    if (e.type === "car.updated") events.push(e);
  });
  const store = createStore(db, bus);
  let at = START;
  const clock = {
    now: () => new Date(at),
    advance: (ms: number) => {
      at += ms;
    },
  };
  const fake = fakePlaces(places);
  const secrets = { resolve: () => undefined, has: () => false, set: () => {} };
  const make = () => createCar({ store, bus, secrets, now: clock.now, provider: async () => fake.provider });
  store.settings.write("car", { ...store.settings.read("car"), enabled: true });
  return {
    store,
    events,
    clock,
    fake,
    make,
    car: make(),
    async [Symbol.asyncDispose]() {
      db.close();
      await dir.remove();
    },
  };
}

function errand(store: Store, title: string, place?: ErrandPlace) {
  const thread = store.threads.create({ kind: "task", title, agent_ids: ["superagent"] });
  return store.tasks.create({
    title,
    status: "todo",
    kind: "errand",
    thread_id: thread.id,
    by: "owner",
    ...(place ? { place } : {}),
  });
}

/** A point, then the background search it started, then the point again: what the phone gets over both answers. */
async function drive(car: Car, p: Parameters<Car["position"]>[0]) {
  const first = car.position(p);
  await car.idle();
  const second = car.position(p);
  return { active: second.active, alerts: [...first.alerts, ...second.alerts] };
}

const point = (clock: { now: () => Date }, metres = 0) => ({
  trip_id: TRIP,
  ...north(metres),
  accuracy_m: 15,
  speed_mps: 10,
  heading_deg: 0,
  at: clock.now().toISOString(),
});

test("a position offers the best errand once, spaced 45 s from the last offer, and tells the panel", async () => {
  await using env = await setup();
  const { car, store, clock, events } = env;
  const milk = errand(store, "Comprar leche", { categories: ["supermarket"] });
  const copies = errand(store, "Fotocopias", { categories: ["stationery"] });
  car.tripStart({ trip_id: TRIP, source: "android_auto", at: clock.now().toISOString() });
  const first = await drive(car, point(clock));
  assert.equal(first.active, true);
  assert.equal(first.alerts.length, 1, "at most one offer per position");
  assert.equal(first.alerts[0]?.task_id, milk.id);
  assert.equal(first.alerts[0]?.place.name, "Acme Market");
  assert.match(first.alerts[0]?.spoken ?? "", /^Comprar leche: Acme Market, a 500 metros\.$/);
  assert.ok(events.some((e) => e.type === "car.updated" && e.alert?.id === first.alerts[0]?.id));
  clock.advance(20_000);
  assert.equal((await drive(car, point(clock, 200))).alerts.length, 0, "spaced");
  clock.advance(30_000);
  const second = await drive(car, point(clock, 200));
  assert.equal(second.alerts[0]?.task_id, copies.id, "the milk errand was spent for this trip");
  clock.advance(50_000);
  assert.equal((await drive(car, point(clock, 300))).alerts.length, 0, "every errand was offered once");
  assert.equal(car.trip().alerts.length, 2, "both wait for an answer");
});

test("next offers the errand's next place right away and never the declined one again this trip", async () => {
  await using env = await setup();
  const { car, store, clock } = env;
  errand(store, "Comprar leche", { categories: ["supermarket"] });
  car.tripStart({ trip_id: TRIP, source: "maps", at: clock.now().toISOString() });
  const [offer] = (await drive(car, point(clock))).alerts;
  assert.ok(offer);
  const answered = car.answer(offer.id, "next");
  assert.equal(answered.alert.answer, "next");
  assert.equal(answered.next?.place.name, "Northwind Foods");
  assert.equal(store.carPrefs.get(offer.place.key)?.declined, 1);
  const last = car.answer(answered.next?.id ?? "", "next");
  assert.equal(last.next, undefined, "no third place within reach");
  clock.advance(60_000);
  assert.equal((await drive(car, point(clock, 100))).alerts.length, 0, "declined places stay out this trip");
});

test("navigate locks the place and counts it; done afterwards closes the errand and counts it too", async () => {
  await using env = await setup();
  const { car, store, clock } = env;
  const milk = errand(store, "Comprar leche", { categories: ["supermarket"] });
  car.tripStart({
    trip_id: TRIP,
    source: "android_auto",
    at: clock.now().toISOString(),
    destination: { lat: -34.5, lon: -58.4, label: "Northwind office" },
  });
  const [offer] = (await drive(car, point(clock))).alerts;
  assert.ok(offer);
  assert.ok(offer.add_stop_url?.includes("waypoints="), "with a destination, a stop on the way");
  car.answer(offer.id, "navigate");
  assert.equal(store.carPrefs.get(offer.place.key)?.accepted, 1);
  assert.equal(car.trip().errands.find((e) => e.task_id === milk.id)?.best?.key, offer.place.key);
  car.answer(offer.id, "done");
  assert.equal(store.tasks.get(milk.id)?.state, "done");
  assert.equal(store.carPrefs.get(offer.place.key)?.done, 1);
  assert.equal(car.places(10)[0]?.key, offer.place.key, "the owner's places list it first");
});

test("skip leaves the errand for the trip, later for a while, silence stops every offer", async () => {
  await using env = await setup();
  const { car, store, clock } = env;
  const milk = errand(store, "Comprar leche", { categories: ["supermarket"] });
  car.tripStart({ trip_id: TRIP, source: "android_auto", at: clock.now().toISOString() });
  const [offer] = (await drive(car, point(clock))).alerts;
  assert.ok(offer);
  car.answer(offer.id, "later");
  assert.equal(car.trip().errands.find((e) => e.task_id === milk.id)?.held, "later");
  clock.advance(60_000);
  assert.equal((await drive(car, point(clock, 100))).alerts.length, 0, "waiting");
  clock.advance(15 * 60_000);
  // Past the 15 minutes, still near where it was put off: held until the car is 3 km away too.
  assert.equal((await drive(car, point(clock, 200))).alerts.length, 0);
  const papers = errand(store, "Fotocopias", { categories: ["stationery"] });
  clock.advance(60_000);
  const [copies] = (await drive(car, point(clock, 200))).alerts;
  assert.equal(copies?.task_id, papers.id);
  car.answer(copies?.id ?? "", "silence");
  errand(store, "Más leche", { categories: ["supermarket"] });
  clock.advance(60_000);
  assert.equal((await drive(car, point(clock, 250))).alerts.length, 0, "silenced trip");
  assert.equal(car.trip().trip?.silenced, true);
  car.errand(milk.id, "skip");
  assert.equal(car.trip().errands.find((e) => e.task_id === milk.id)?.held, "skip");
});

test("the trip lives in the store: a restarted core keeps it and what was already offered", async () => {
  await using env = await setup();
  const { store, clock } = env;
  errand(store, "Comprar leche", { categories: ["supermarket"] });
  env.car.tripStart({ trip_id: TRIP, source: "android_auto", at: clock.now().toISOString() });
  assert.equal((await drive(env.car, point(clock))).alerts.length, 1);
  const restarted = env.make();
  assert.equal(restarted.trip().trip?.id, TRIP);
  assert.equal(restarted.trip().alerts.length, 1);
  clock.advance(60_000);
  const after = await drive(restarted, point(clock, 100));
  assert.equal(after.active, true, "the phone is not told the trip ended");
  assert.equal(after.alerts.length, 0, "the one-shot survived the restart");
});

test("a failed search offers nothing and is tried again at the next point", async () => {
  await using env = await setup();
  const { car, store, clock, fake } = env;
  errand(store, "Comprar leche", { categories: ["supermarket"] });
  // No hardware store anywhere: it stays open all trip, so the trip keeps warming the way ahead for it.
  errand(store, "Comprar tornillos", { categories: ["hardware"] });
  car.tripStart({ trip_id: TRIP, source: "android_auto", at: clock.now().toISOString() });
  fake.fail(true);
  assert.equal(car.position(point(clock)).alerts.length, 0);
  await car.idle();
  const failed = fake.calls.length;
  assert.ok(failed > 0);
  fake.fail(false);
  clock.advance(30_000);
  assert.equal((await drive(car, point(clock, 50))).alerts.length, 1);
  const warmed = fake.calls.length;
  assert.ok(warmed > failed, "searched again");
  clock.advance(60_000);
  await drive(car, point(clock, 1000));
  assert.equal(fake.calls.length, warmed, "the plan is reused until the car moves 1.5 km");
  clock.advance(60_000);
  await drive(car, point(clock, 1700));
  assert.ok(fake.calls.length > warmed, "past it, the area ahead is warmed again");
});

test("a position never waits for a search: the offer comes on the panel when it ends, and to the phone next point", async () => {
  await using env = await setup();
  const { store, clock } = env;
  let release = () => {};
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const slow: PlaceProvider = {
    id: "osm",
    async search(area, categories, at) {
      await gate;
      return env.fake.provider.search(area, categories, at);
    },
  };
  const bus = createBus();
  const seen: CoreEvent[] = [];
  bus.on((e) => seen.push(e));
  const car = createCar({
    store,
    bus,
    secrets: { resolve: () => undefined, has: () => false, set: () => {} },
    now: clock.now,
    provider: async () => slow,
  });
  const offers = () => seen.filter((e) => e.type === "car.updated" && e.alert);
  errand(store, "Comprar leche", { categories: ["supermarket"] });
  car.tripStart({ trip_id: TRIP, source: "android_auto", at: clock.now().toISOString() });
  assert.deepEqual(car.position(point(clock)), { alerts: [], active: true }, "answered with no search done");
  assert.equal(car.trip().errands[0]?.best, undefined);
  release();
  await car.idle();
  assert.equal(offers().length, 1, "the panel hears of it when the search ends");
  const [delivered] = car.position(point(clock, 50)).alerts;
  assert.equal(delivered?.place.name, "Acme Market", "the background offer reaches the phone");
  assert.deepEqual(car.position(point(clock, 60)).alerts, [], "given once");
});

test("a preview waits for the search and says when it did not answer", async () => {
  await using env = await setup();
  const { car, store, fake } = env;
  errand(store, "Comprar leche", { categories: ["supermarket"] });
  const shown = await car.preview(north(0));
  assert.equal(shown[0]?.best?.name, "Acme Market");
  fake.fail(true);
  await assert.rejects(car.preview(north(5000)), /did not answer in time/);
});

test("an errand without categories is classified for the search; car mode off does nothing", async () => {
  await using env = await setup();
  const { car, store, clock, fake } = env;
  errand(store, "Comprar leche");
  car.tripStart({ trip_id: TRIP, source: "android_auto", at: clock.now().toISOString() });
  const [offer] = (await drive(car, point(clock))).alerts;
  assert.equal(offer?.place.name, "Acme Market");
  car.configure({ enabled: false });
  assert.equal(car.trip().trip, undefined, "turning it off ends the trip");
  const calls = fake.calls.length;
  assert.deepEqual(car.tripStart({ trip_id: "trip-0002-acme", source: "maps", at: clock.now().toISOString() }), {
    alerts: [],
    errands: [],
  });
  assert.equal((await drive(car, { ...point(clock), trip_id: "trip-0002-acme" })).active, false);
  assert.equal(fake.calls.length, calls);
});

test("a trip with no point for 20 minutes ends on its own", async () => {
  await using env = await setup();
  const { car, clock, events } = env;
  car.tripStart({ trip_id: TRIP, source: "android_auto", at: clock.now().toISOString() });
  await drive(car, point(clock));
  clock.advance(IDLE_TRIP_MS - 1000);
  car.check.run(clock.now());
  assert.equal(car.trip().trip?.id, TRIP);
  clock.advance(2000);
  const before = events.length;
  car.check.run(clock.now());
  assert.equal(car.trip().trip, undefined);
  assert.ok(events.length > before);
  assert.equal((await drive(car, point(clock))).active, false, "the phone hears it ended");
  car.tripStart({ trip_id: TRIP, source: "android_auto", at: clock.now().toISOString() });
  assert.equal(car.trip().trip?.id, TRIP, "starting the same trip again opens it");
});
