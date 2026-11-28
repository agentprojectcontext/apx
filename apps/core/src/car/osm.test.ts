import assert from "node:assert/strict";
import { test } from "node:test";
import { type OverpassElement, osmProvider, overpassQuery, toStoredPlace } from "./osm.ts";
import type { Fetch, PlaceCache, StoredPlace } from "./provider.ts";

const CENTER = { lat: -31.4201, lon: -64.1888 };
const TZ = "America/Argentina/Cordoba";

/** A small Overpass answer around CENTER, with generic names. */
const FIXTURE: { version: number; elements: OverpassElement[] } = {
  version: 0.6,
  elements: [
    {
      type: "node",
      id: 101,
      lat: -31.4185,
      lon: -64.1888,
      tags: {
        shop: "supermarket",
        name: "Supermercado Acme",
        brand: "Acme",
        "addr:street": "Calle Falsa",
        "addr:housenumber": "123",
        opening_hours: "Mo-Sa 08:00-21:00",
      },
    },
    {
      type: "way",
      id: 202,
      center: { lat: -31.4215, lon: -64.187 },
      tags: { amenity: "pharmacy", name: "Farmacia Northwind", opening_hours: "24/7" },
    },
    { type: "node", id: 303, lat: -31.4199, lon: -64.1893, tags: { amenity: "atm", operator: "Banco Acme" } },
    { type: "node", id: 404, lat: -31.4203, lon: -64.1885, tags: { shop: "kiosk" } },
    { type: "node", id: 505, lat: -31.4202, lon: -64.1886, tags: { amenity: "restaurant", name: "Parrilla Acme" } },
    { type: "node", id: 606, lat: -31.414, lon: -64.1888, tags: { shop: "convenience", name: "Almacén Contoso" } },
  ],
};

function memoryCache(): PlaceCache & { tiles: Map<string, { at: string; places: StoredPlace[] }> } {
  const tiles = new Map<string, { at: string; places: StoredPlace[] }>();
  return {
    tiles,
    freshTiles: (keys, since) => new Set(keys.filter((k) => (tiles.get(k)?.at ?? "") > since)),
    putTile: (key, places, at) => void tiles.set(key, { at, places: [...places] }),
    placesIn: (keys) => keys.flatMap((k) => tiles.get(k)?.places ?? []),
  };
}

type Call = { url: string; init?: RequestInit; at: number };

function setup(answers: Array<number | "throw"> = []) {
  let clock = Date.parse("2026-11-23T15:00:00Z"); // Monday 12:00 in Córdoba
  const waits: number[] = [];
  const calls: Call[] = [];
  const fetch: Fetch = async (url, init) => {
    calls.push({ url, init, at: clock });
    const next = answers.shift() ?? 200;
    if (next === "throw") throw new Error("network down");
    if (next !== 200) return new Response("busy", { status: next });
    return Response.json(FIXTURE);
  };
  const cache = memoryCache();
  const provider = osmProvider({
    cache,
    fetch,
    now: () => new Date(clock),
    sleep: async (ms) => {
      waits.push(ms);
      clock += ms;
    },
    timeZone: TZ,
  });
  return {
    provider,
    cache,
    calls,
    waits,
    advance: (ms: number) => {
      clock += ms;
    },
    now: () => new Date(clock),
  };
}

const area = (radius_m = 1_000) => ({ ...CENTER, radius_m });

test("toStoredPlace keeps named places with an errand category", () => {
  const [superm, pharmacy, atm, kiosk, restaurant] = FIXTURE.elements.map((el) => toStoredPlace(el));
  assert.deepEqual(superm, {
    key: "osm:node/101",
    name: "Supermercado Acme",
    lat: -31.4185,
    lon: -64.1888,
    categories: ["supermarket"],
    brand: "Acme",
    address: "Calle Falsa 123",
    opening_hours: "Mo-Sa 08:00-21:00",
  });
  assert.equal(pharmacy?.key, "osm:way/202");
  assert.equal(pharmacy?.lat, -31.4215);
  assert.equal(atm?.name, "Banco Acme");
  assert.equal(kiosk, undefined, "no name nor brand");
  assert.equal(restaurant, undefined, "no errand category");
});

test("one query asks for every category's tags, nodes and ways, by centre", () => {
  const q = overpassQuery(["69y7pk"]);
  assert.match(q, /^\[out:json\]\[timeout:10\]\[bbox:-?\d/);
  assert.match(q, /node\["shop"~"\^\(supermarket\|.*stationery.*\)\$"\];/);
  assert.match(q, /way\["amenity"~"\^\(.*fuel.*\)\$"\];/);
  assert.match(q, /node\["office"="courier"\];/);
  assert.match(q, /out center tags;$/);
});

test("search returns the requested categories within the radius, nearest first, with hours", async () => {
  const s = setup();
  const found = await s.provider.search(area(), ["pharmacy", "supermarket"], s.now());
  assert.deepEqual(
    found.map((p) => [p.key, p.category, p.open, p.closes_soon]),
    [
      ["osm:node/101", "supermarket", "open", false], // 180 m
      ["osm:way/202", "pharmacy", "open", false], // 230 m
    ],
  );
  assert.equal(found[0]?.source, "osm");
  assert.equal(found[0]?.address, "Calle Falsa 123");
  assert.equal(s.calls.length, 1, "one request for all the tiles");
  const init = s.calls[0]?.init;
  assert.equal(init?.method, "POST");
  assert.equal(new Headers(init?.headers).get("user-agent"), "APX (errands on the way)");
  assert.match(decodeURIComponent(String(init?.body).slice(5)), /out center tags;/);
  // The convenience store is 680 m away: in at 1 km, out at 500 m.
  const kiosks = await s.provider.search(area(), ["kiosk"], s.now());
  assert.deepEqual(
    kiosks.map((p) => p.name),
    ["Almacén Contoso"],
  );
  assert.deepEqual(await s.provider.search(area(500), ["kiosk"], s.now()), []);
});

test("fresh tiles are not fetched again; after 7 days they are", async () => {
  const s = setup();
  await s.provider.search(area(), ["supermarket"], s.now());
  await s.provider.search(area(), ["atm"], s.now());
  assert.equal(s.calls.length, 1);
  s.advance(8 * 24 * 60 * 60 * 1000);
  await s.provider.search(area(), ["atm"], s.now());
  assert.equal(s.calls.length, 2);
});

test("a busy or failing endpoint falls back to the next one", async () => {
  const s = setup([429, 200]);
  const found = await s.provider.search(area(), ["supermarket"], s.now());
  assert.equal(found.length, 1);
  assert.deepEqual(
    s.calls.map((c) => c.url),
    ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"],
  );
  const t = setup([503, "throw"]);
  await assert.rejects(t.provider.search(area(), ["supermarket"], t.now()), /unavailable/);
  assert.equal(t.calls.length, 2);
});

test("requests go one at a time and at least 2 s apart", async () => {
  const s = setup([429, 200, 200]);
  const far = { lat: CENTER.lat + 0.2, lon: CENTER.lon, radius_m: 300 };
  await Promise.all([
    s.provider.search(area(), ["supermarket"], s.now()),
    s.provider.search(far, ["supermarket"], s.now()),
  ]);
  assert.equal(s.calls.length, 3);
  for (let i = 1; i < s.calls.length; i++) {
    const gap = (s.calls[i]?.at ?? 0) - (s.calls[i - 1]?.at ?? 0);
    assert.ok(gap >= 2_000, `gap ${gap}`);
  }
  assert.deepEqual(s.waits, [2_000, 2_000]);
});

test("when Overpass fails, places fetched before are used even if stale; never fetched is an error", async () => {
  const s = setup([200, 503, 503]);
  await s.provider.search(area(), ["supermarket"], s.now());
  s.advance(30 * 24 * 60 * 60 * 1000);
  const stale = await s.provider.search(area(), ["supermarket"], s.now());
  assert.deepEqual(
    stale.map((p) => p.key),
    ["osm:node/101"],
  );
  const t = setup([503, 503]);
  await assert.rejects(t.provider.search(area(), ["supermarket"], t.now()));
  assert.equal(t.cache.tiles.size, 0);
});

test("a timed-out Overpass answer is not cached", async () => {
  let clock = Date.parse("2026-11-23T15:00:00Z");
  const cache = memoryCache();
  const provider = osmProvider({
    cache,
    endpoints: ["https://overpass.example/api/interpreter"],
    fetch: async () => Response.json({ elements: [], remark: "runtime error: Query timed out" }),
    now: () => new Date(clock),
    sleep: async (ms) => {
      clock += ms;
    },
  });
  await assert.rejects(provider.search(area(), ["supermarket"], new Date(clock)));
  assert.equal(cache.tiles.size, 0);
});
