import assert from "node:assert/strict";
import { test } from "node:test";
import type { CarAlert, CarTripView } from "../../../../packages/protocol/src/car.ts";
import { translator } from "../i18n/index.ts";
import {
  answersFor,
  CATEGORIES,
  CATEGORY_KEY,
  checklist,
  distanceLabel,
  MAX_CATEGORIES,
  nativeConfig,
  placeForm,
  placeFromForm,
  samePlace,
  statusLine,
  toggleCategory,
  tripSummary,
} from "./model.ts";
import type { CarNativeStatus } from "./native.ts";

const off: CarNativeStatus = {
  available: true,
  enabled: false,
  listener: false,
  location: false,
  notifications: false,
  car_connected: false,
};
const ready: CarNativeStatus = { ...off, enabled: true, listener: true, location: true, notifications: true };

test("the checklist marks what the phone still has to allow, in setup order", () => {
  assert.deepEqual(
    checklist({ ...ready, location: false }).map((item) => [item.id, item.done]),
    [
      ["listener", true],
      ["location", false],
      ["notifications", true],
    ],
  );
});

test("the status line says the trip first, then the car, then what is missing", () => {
  assert.equal(statusLine(off), undefined);
  assert.deepEqual(statusLine({ ...ready, listener: false }), { key: "carNeedsSetup", tone: "warning" });
  assert.equal(statusLine(ready)?.key, "carWaiting");
  assert.equal(statusLine({ ...ready, car_connected: true })?.key, "carConnected");
  const trip = { id: "trip-0001", source: "android_auto" as const, started_at: "2026-11-27T10:00:00Z" };
  assert.deepEqual(statusLine({ ...ready, car_connected: true, trip, last_sent_at: "2026-11-27T10:05:00Z" }), {
    key: "carTripOn",
    tone: "brand",
    sent: "2026-11-27T10:05:00Z",
  });
  assert.equal(statusLine({ ...ready, trip: { ...trip, source: "manual" } })?.key, "carTestTripOn");
});

test("the place form keeps the best category first, caps them, and keeps a fixed point it does not edit", () => {
  let picked = toggleCategory([], "supermarket");
  picked = toggleCategory(picked, "kiosk");
  assert.deepEqual(picked, ["supermarket", "kiosk"]);
  assert.deepEqual(toggleCategory(picked, "supermarket"), ["kiosk"]);
  const full = CATEGORIES.slice(0, MAX_CATEGORIES);
  assert.deepEqual(toggleCategory(full, "bank"), full);

  assert.deepEqual(placeFromForm({ categories: ["pharmacy"], brand: "  Acme   Farma " }), {
    categories: ["pharmacy"],
    brand: "Acme Farma",
  });
  const before = { categories: ["post_office" as const], at: { lat: -34.6, lon: -58.4, label: "Northwind" } };
  assert.deepEqual(placeFromForm({ categories: [], brand: "" }, before), { categories: [], at: before.at });
  assert.equal(placeFromForm({ categories: [], brand: "  " }), null);
  assert.deepEqual(placeForm(undefined), { categories: [], brand: "" });
  assert.deepEqual(placeForm({ categories: ["bakery"], brand: "Acme" }), { categories: ["bakery"], brand: "Acme" });
  assert.ok(samePlace(placeFromForm(placeForm(undefined)), undefined));
  assert.ok(!samePlace({ categories: ["bakery"] }, undefined));
});

test("every category has a label in sentence case in both languages", () => {
  for (const lang of ["en", "es"] as const) {
    const t = translator(lang);
    for (const category of CATEGORIES) {
      const label = t(CATEGORY_KEY[category]);
      assert.ok(label && label[0] === label[0]?.toLocaleUpperCase(), `${lang} ${category}: ${label}`);
    }
  }
  assert.equal(translator("es")(CATEGORY_KEY.stationery), "Librería");
  assert.equal(translator("es")(CATEGORY_KEY.gas_station), "Estación de servicio");
});

test("an offer shows only the answers the core allows, going first", () => {
  assert.deepEqual(
    answersFor(["done", "skip", "navigate", "silence", "add_stop"]).map((answer) => answer.action),
    ["navigate", "skip", "done"],
  );
  assert.deepEqual(
    answersFor(["navigate", "next", "later", "skip", "done"]).map((answer) => translator("es")(answer.label)),
    ["Voy", "Otro lugar", "Más tarde", "No en este viaje", "Ya lo hice"],
  );
});

test("the trip banner counts the offers still waiting, and shows when only the phone knows the trip", () => {
  const alert = (id: string, answer?: CarAlert["answer"]) => ({ id, ...(answer ? { answer } : {}) }) as CarAlert;
  const trip = { id: "trip-0001", source: "maps", started_at: "2026-11-27T10:00:00Z", silenced: false } as const;
  const view = {
    trip,
    alerts: [alert("a1"), alert("a2"), alert("a3", "skip")],
    errands: [],
  } as CarTripView;
  assert.deepEqual(tripSummary(view, undefined), { active: true, waiting: 2 });
  assert.deepEqual(tripSummary({ ...view, trip: { ...trip, ended_at: "2026-11-27T11:00:00Z" } }, undefined), {
    active: false,
    waiting: 0,
  });
  const phoneTrip = { ...ready, trip: { id: "trip-0002", source: "manual" as const, started_at: "x" } };
  assert.deepEqual(tripSummary(undefined, phoneTrip), { active: true, waiting: 0 });
  assert.deepEqual(tripSummary(undefined, ready), { active: false, waiting: 0 });
});

test("the native side is handed the core and key while paired, and an empty key once unpaired", () => {
  const creds = { url: "https://core.example.com", token: "paired-test-token" };
  assert.deepEqual(nativeConfig(creds, true, "es", "Acme"), {
    url: creds.url,
    token: creds.token,
    enabled: true,
    lang: "es",
    agent_name: "Acme",
  });
  assert.deepEqual(nativeConfig(undefined, true, "en"), { url: "", token: "", enabled: false, lang: "en" });
});

test("distances read in meters under a kilometer", () => {
  assert.equal(distanceLabel(234), "230 m");
  assert.equal(distanceLabel(1440), "1.4 km");
});
