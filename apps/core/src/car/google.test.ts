import assert from "node:assert/strict";
import { test } from "node:test";
import { GOOGLE_FIELD_MASK, GOOGLE_TEXT_SEARCH, googleProvider } from "./google.ts";
import type { Fetch } from "./provider.ts";

const AREA = { lat: -31.4201, lon: -64.1888, radius_m: 1_000 };
const KEY = "test-key-not-real";

const PLACES = {
  places: [
    {
      id: "far-one",
      displayName: { text: "Supermercado Lejano" },
      location: { latitude: -31.5, longitude: -64.1888 },
      types: ["supermarket"],
    },
    {
      id: "acme-1",
      displayName: { text: "Supermercado Acme" },
      location: { latitude: -31.4185, longitude: -64.1888 },
      types: ["supermarket", "grocery_store", "store"],
      formattedAddress: "Calle Falsa 123, Córdoba",
      currentOpeningHours: { openNow: true },
      rating: 4.3,
    },
    { id: "broken", displayName: { text: "Sin ubicación" } },
  ],
};

function setup(status = 200) {
  let clock = Date.parse("2026-11-23T15:00:00Z");
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetch: Fetch = async (url, init) => {
    calls.push({ url, init });
    if (status !== 200) return Response.json({ error: { status: "PERMISSION_DENIED" } }, { status });
    return Response.json(PLACES);
  };
  const provider = googleProvider({ key: KEY, fetch, language: "es", now: () => new Date(clock) });
  return {
    provider,
    calls,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

test("text search sends the field mask, the key header and one typed query per category", async () => {
  const s = setup();
  await s.provider.search(AREA, ["supermarket", "stationery"], new Date());
  assert.equal(s.calls.length, 2);
  const [first, second] = s.calls;
  assert.equal(first?.url, GOOGLE_TEXT_SEARCH);
  assert.equal(first?.init?.method, "POST");
  const headers = new Headers(first?.init?.headers);
  assert.equal(headers.get("x-goog-api-key"), KEY);
  assert.equal(headers.get("x-goog-fieldmask"), GOOGLE_FIELD_MASK);
  assert.deepEqual(JSON.parse(String(first?.init?.body)), {
    textQuery: "supermercado",
    includedType: "supermarket",
    strictTypeFiltering: true,
    locationBias: { circle: { center: { latitude: AREA.lat, longitude: AREA.lon }, radius: 1_000 } },
    maxResultCount: 10,
    languageCode: "es",
  });
  // Google has no stationery type: the words carry it.
  const body = JSON.parse(String(second?.init?.body));
  assert.equal(body.includedType, undefined);
  assert.equal(body.textQuery, "librería artículos escolares");
});

test("answers map to places inside the circle, with open now and rating", async () => {
  const s = setup();
  const found = await s.provider.search(AREA, ["supermarket"], new Date());
  assert.deepEqual(found, [
    {
      key: "google:acme-1",
      name: "Supermercado Acme",
      lat: -31.4185,
      lon: -64.1888,
      address: "Calle Falsa 123, Córdoba",
      category: "supermarket",
      categories: ["supermarket", "grocery"],
      open: "open",
      rating: 4.3,
      source: "google",
    },
  ]);
});

test("at most 3 categories, and the same block is answered from memory for 10 minutes", async () => {
  const s = setup();
  await s.provider.search(AREA, ["supermarket", "grocery", "kiosk", "pharmacy"], new Date());
  assert.equal(s.calls.length, 3);
  await s.provider.search({ ...AREA, lat: AREA.lat + 0.0001 }, ["supermarket"], new Date());
  assert.equal(s.calls.length, 3);
  s.advance(11 * 60 * 1000);
  await s.provider.search(AREA, ["supermarket"], new Date());
  assert.equal(s.calls.length, 4);
});

test("a missing key or a refusal is an error that never shows the key", async () => {
  const none = googleProvider({ key: undefined, fetch: async () => Response.json(PLACES) });
  await assert.rejects(none.search(AREA, ["supermarket"], new Date()), /needs an API key/);
  const blank = googleProvider({ key: "  ", fetch: async () => Response.json(PLACES) });
  await assert.rejects(blank.search(AREA, ["supermarket"], new Date()), /needs an API key/);
  const s = setup(403);
  await assert.rejects(s.provider.search(AREA, ["supermarket"], new Date()), (err: Error) => {
    assert.match(err.message, /403 \(PERMISSION_DENIED\)/);
    assert.ok(!err.message.includes(KEY));
    return true;
  });
});
