import assert from "node:assert/strict";
import { test } from "node:test";
import type { PreferredPlace } from "@apx/protocol";
import type { Hold } from "../domain/car-alerts.ts";
import { heldNow, type MatchContext, type MatchErrand, pick, quiet, rank, reachM } from "./matcher.ts";
import type { FoundPlace } from "./provider.ts";

// A generic city; 0.001° of latitude is about 111 m.
const HERE = { lat: -34.6, lon: -58.4 };
const NOW = new Date("2026-11-27T15:00:00.000Z");
const north = (m: number) => ({ lat: HERE.lat + m / 111_195, lon: HERE.lon });

const place = (key: string, at: { lat: number; lon: number }, extra: Partial<FoundPlace> = {}): FoundPlace => ({
  key,
  name: key,
  lat: at.lat,
  lon: at.lon,
  source: "osm",
  categories: ["supermarket"],
  ...extra,
});

const ctx = (o: Partial<MatchContext> = {}): MatchContext => ({
  position: { ...HERE, speed_mps: 10, heading_deg: 0 },
  reach: "normal",
  holds: [],
  prefs: new Map(),
  avoided: new Set(),
  now: NOW,
  ...o,
});

const errand = (task_id: string, candidates: FoundPlace[]): MatchErrand => ({
  task_id,
  place: { categories: ["supermarket"] },
  candidates,
});

const pref = (key: string, o: Partial<PreferredPlace>): PreferredPlace => ({
  key,
  name: key,
  lat: 0,
  lon: 0,
  categories: [],
  accepted: 0,
  declined: 0,
  done: 0,
  last_at: NOW.toISOString(),
  ...o,
});

test("reach follows the setting and stretches with speed up to twice the base", () => {
  assert.equal(reachM("near", 0), 600);
  assert.equal(reachM("normal", 10), 1500);
  assert.equal(reachM("normal", 25), 2250, "90 s at 25 m/s");
  assert.equal(reachM("normal", 60), 3000, "capped at twice the base");
  assert.equal(reachM("far", 0), 4000);
  assert.equal(reachM("near", 0, 2000), 2000, "the errand's own radius wins");
});

test("a place behind the moving car counts only within 300 m; ahead, the nearest wins", () => {
  const behindFar = place("behind-far", north(-800));
  const behindNear = place("behind-near", north(-250));
  const ahead = place("ahead", north(900));
  const tooFar = place("too-far", north(1700));
  const ranked = rank(errand("t1", [behindFar, behindNear, ahead, tooFar]), ctx());
  assert.deepEqual(
    ranked.map((r) => r.place.key),
    ["behind-near", "ahead"],
  );
  // Standing still, there is no heading: what is behind counts like anything else.
  const still = rank(errand("t1", [behindFar, ahead]), ctx({ position: { ...HERE, speed_mps: 0, heading_deg: 0 } }));
  assert.deepEqual(
    still.map((r) => r.place.key),
    ["behind-far", "ahead"],
  );
});

test("the owner's answers, the hours and the rating move a place up or down", () => {
  const near = place("near", north(500));
  const liked = place("liked", north(900));
  assert.equal(rank(errand("t1", [near, liked]), ctx())[0]?.place.key, "near");
  const prefs = new Map([["liked", pref("liked", { accepted: 4 })]]);
  assert.equal(rank(errand("t1", [near, liked]), ctx({ prefs }))[0]?.place.key, "liked", "accepted before: −600 m");
  const declined = new Map([["near", pref("near", { declined: 2 })]]);
  assert.equal(rank(errand("t1", [near, liked]), ctx({ prefs: declined }))[0]?.place.key, "liked");
  const closing = place("near", north(500), { open: "open", closes_soon: true });
  const open = place("open", north(800), { open: "open" });
  assert.equal(rank(errand("t1", [closing, open]), ctx())[0]?.place.key, "open", "closing within the hour costs");
  const closed = place("closed", north(100), { open: "closed" });
  assert.deepEqual(
    rank(errand("t1", [closed]), ctx()).map((r) => r.place.key),
    [],
    "a closed place is never offered",
  );
  const rated = place("rated", north(600), { rating: 4.9 });
  assert.equal(rank(errand("t1", [near, rated]), ctx())[0]?.place.key, "rated");
  assert.deepEqual(
    rank(errand("t1", [near]), ctx({ avoided: new Set(["near"]) })),
    [],
    "an avoided place is never offered",
  );
});

test("a brand narrows the places, and a declined place is gone for that errand in the trip", () => {
  const acme = place("acme", north(900), { name: "Acme Express", brand: "Acme" });
  const other = place("northwind", north(400), { name: "Northwind" });
  const branded: MatchErrand = {
    task_id: "t1",
    place: { categories: ["supermarket"], brand: "acme" },
    candidates: [acme, other],
  };
  assert.deepEqual(
    rank(branded, ctx()).map((r) => r.place.key),
    ["acme"],
  );
  const holds: Hold[] = [{ task_id: "t1", kind: "declined_place", place_key: "northwind" }];
  assert.deepEqual(
    rank(errand("t1", [acme, other]), ctx({ holds })).map((r) => r.place.key),
    ["acme"],
  );
  assert.deepEqual(
    rank(errand("t2", [acme, other]), ctx({ holds })).map((r) => r.place.key),
    ["northwind", "acme"],
    "another errand still gets it",
  );
});

test("one offer per position: the best errand, never one already offered or held in the trip", () => {
  const milk = errand("milk", [place("far-shop", north(1200))]);
  const bread = errand("bread", [place("bakery", north(300), { categories: ["bakery"] })]);
  assert.equal(pick([milk, bread], new Set(), ctx())?.task_id, "bread");
  assert.equal(pick([milk, bread], new Set(["bread"]), ctx())?.task_id, "milk", "one-shot per trip and errand");
  const skip: Hold[] = [{ task_id: "bread", kind: "skip" }];
  assert.equal(pick([milk, bread], new Set(), ctx({ holds: skip }))?.task_id, "milk");
  assert.equal(pick([milk, bread], new Set(["milk", "bread"]), ctx()), undefined);
});

test("later holds an errand 15 minutes and 3 km, whichever comes later", () => {
  const holds: Hold[] = [
    { task_id: "t1", kind: "later", until_at: new Date(NOW.getTime() + 15 * 60_000).toISOString(), until: HERE },
  ];
  assert.equal(heldNow("t1", holds, north(4000), NOW), "later", "far, but not yet 15 minutes");
  const after = new Date(NOW.getTime() + 16 * 60_000);
  assert.equal(heldNow("t1", holds, north(1000), after), "later", "the time passed, still within 3 km");
  assert.equal(heldNow("t1", holds, north(3500), after), undefined);
});

test("no offer is looked for on a silenced trip, a bad fix, or within 45 s of the last one", () => {
  assert.equal(quiet({ silenced: true, now: NOW }), "silenced");
  assert.equal(quiet({ silenced: false, accuracy_m: 500, now: NOW }), "accuracy");
  const recent = new Date(NOW.getTime() - 30_000).toISOString();
  assert.equal(quiet({ silenced: false, last_alert_at: recent, now: NOW }), "spacing");
  const old = new Date(NOW.getTime() - 46_000).toISOString();
  assert.equal(quiet({ silenced: false, accuracy_m: 20, last_alert_at: old, now: NOW }), undefined);
});
