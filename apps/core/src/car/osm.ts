// OpenStreetMap places through Overpass (rules/ERRANDS_ON_THE_WAY.md#providers): geohash-6 tiles fetched once for every
// category, kept 7 days in the PlaceCache, one request in flight and at least 2 s apart. Fails closed.
import type { ErrandCategory } from "@apx/protocol";
import { errorMessage, unavailable } from "../errors.ts";
import { osmCategories, osmSelectorValues } from "./categories.ts";
import { bboxOf, distanceM, geohash, TILE_PRECISION, tilesAround } from "./geo.ts";
import { evaluateHours } from "./hours.ts";
import type { Fetch, FoundPlace, PlaceCache, PlaceProvider, SearchArea, StoredPlace } from "./provider.ts";

// Public instances in order; under load one answers 502 at once or hangs, so the next one is tried.
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
] as const;

const FRESH_MS = 7 * 24 * 60 * 60 * 1000;
const DEADLINE_MS = 10_000;
const USER_AGENT = "APX (errands on the way)";
const EVER = new Date(0).toISOString();

export type OsmOptions = {
  cache: PlaceCache;
  fetch: Fetch;
  now: () => Date;
  endpoints?: readonly string[];
  /** Least time between two requests' starts. */
  minGapMs?: number;
  /** Waits between requests; replaced in tests so no real time passes. */
  sleep?: (ms: number) => Promise<void>;
  /** Time zone the hours are read in; unset: the machine's (the owner's). */
  timeZone?: string;
  /** Most tiles one query covers. */
  batchSize?: number;
  /** Per-request deadline; public instances under load can take longer than the default. */
  deadlineMs?: number;
};

export type OverpassElement = {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

/** One query for every category's tags in a box: nodes and ways, ways by their centre. */
export function overpassQuery(tiles: readonly string[]): string {
  const b = bboxOf(tiles);
  const box = [b.south, b.west, b.north, b.east].map((n) => n.toFixed(6)).join(",");
  // One statement per key: a busy public instance answers this in seconds where one per value timed out.
  const lines = [...osmSelectorValues()].map(([key, values]) =>
    values.length === 1 ? `nwr["${key}"="${values[0]}"];` : `nwr["${key}"~"^(${values.join("|")})$"];`,
  );
  return `[out:json][timeout:25][bbox:${box}];\n(\n${lines.join("\n")}\n);\nout center tags qt;`;
}

/** An Overpass element as a cached place, or undefined when it has no name or no errand category. */
export function toStoredPlace(el: OverpassElement): StoredPlace | undefined {
  const tags = el.tags ?? {};
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  if (lat === undefined || lon === undefined) return undefined;
  if (el.type !== "node" && el.type !== "way") return undefined;
  const brand = tags.brand ?? tags.operator;
  // ATMs and lockers are often tagged with only their operator; that is the name a person knows them by.
  const name = tags.name ?? brand;
  if (!name) return undefined;
  const categories = osmCategories(tags);
  if (categories.length === 0) return undefined;
  const street = tags["addr:street"];
  const number = tags["addr:housenumber"];
  return {
    key: `osm:${el.type}/${el.id}`,
    name,
    lat,
    lon,
    categories,
    brand,
    address: street ? (number ? `${street} ${number}` : street) : undefined,
    opening_hours: tags.opening_hours,
  };
}

/**
 * Missing tiles in batches of neighbours (geohash order keeps each query's box small), the batch nearest the point
 * first so the part of the way that matters arrives first.
 */
function batches(missing: readonly string[], size: number, from: { lat: number; lon: number }): string[][] {
  const sorted = missing.toSorted();
  const out: string[][] = [];
  for (let i = 0; i < sorted.length; i += size) out.push(sorted.slice(i, i + size));
  const near = (batch: string[]) => {
    const b = bboxOf(batch);
    return distanceM(from, { lat: (b.south + b.north) / 2, lon: (b.west + b.east) / 2 });
  };
  return out.toSorted((a, b) => near(a) - near(b));
}

export function osmProvider(opts: OsmOptions): PlaceProvider {
  const endpoints = opts.endpoints ?? OVERPASS_ENDPOINTS;
  const gap = opts.minGapMs ?? 2_000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const batchSize = opts.batchSize ?? 12;
  let queue: Promise<unknown> = Promise.resolve();
  let lastStart = Number.NEGATIVE_INFINITY;

  async function attempt(url: string, query: string, signal: AbortSignal | undefined): Promise<OverpassElement[]> {
    const wait = lastStart + gap - opts.now().getTime();
    if (wait > 0) await sleep(wait);
    signal?.throwIfAborted();
    lastStart = opts.now().getTime();
    const deadline = AbortSignal.timeout(opts.deadlineMs ?? DEADLINE_MS);
    const res = await opts.fetch(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": USER_AGENT },
      body: `data=${encodeURIComponent(query)}`,
      signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
    });
    if (!res.ok) throw Object.assign(new Error(`Overpass answered ${res.status}`), { status: res.status });
    const json = (await res.json()) as { elements?: OverpassElement[]; remark?: string };
    signal?.throwIfAborted();
    // A query that ran out of time answers 200 with a partial list and a remark; caching it would hide places.
    if (json.remark && /error/i.test(json.remark)) throw new Error(`Overpass: ${json.remark.slice(0, 120)}`);
    return json.elements ?? [];
  }

  async function overpass(query: string, signal: AbortSignal | undefined): Promise<OverpassElement[]> {
    let last: unknown;
    for (const url of endpoints) {
      if (signal?.aborted) throw signal.reason;
      try {
        return await attempt(url, query, signal);
      } catch (err) {
        if (signal?.aborted) throw signal.reason;
        // A malformed query fails the same everywhere.
        if ((err as { status?: number }).status === 400) throw err;
        last = err;
      }
    }
    throw unavailable(`OpenStreetMap places are unavailable: ${errorMessage(last, 160)}`);
  }

  /** One request at a time, in the order asked. */
  function enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = queue.then(job, job);
    queue = run.catch(() => undefined);
    return run;
  }

  async function fetchTiles(tiles: readonly string[], signal: AbortSignal | undefined): Promise<void> {
    // Searches for several errands share tiles: a batch another search fetched while this one waited is skipped.
    const elements = await enqueue(() => {
      signal?.throwIfAborted();
      const since = new Date(opts.now().getTime() - FRESH_MS).toISOString();
      const fresh = opts.cache.freshTiles(tiles, since);
      return fresh.size === tiles.length ? Promise.resolve(undefined) : overpass(overpassQuery(tiles), signal);
    });
    if (!elements) return;
    const byTile = new Map<string, StoredPlace[]>(tiles.map((t) => [t, []]));
    for (const el of elements) {
      const place = toStoredPlace(el);
      if (!place) continue;
      byTile.get(geohash(place.lat, place.lon, TILE_PRECISION))?.push(place);
    }
    const at = opts.now().toISOString();
    for (const [tile, places] of byTile) opts.cache.putTile(tile, places, at);
  }

  async function refresh(
    tiles: readonly string[],
    from: { lat: number; lon: number },
    signal: AbortSignal | undefined,
  ): Promise<void> {
    const since = new Date(opts.now().getTime() - FRESH_MS).toISOString();
    const fresh = opts.cache.freshTiles(tiles, since);
    const failed: string[] = [];
    let error: unknown;
    for (const batch of batches(
      tiles.filter((t) => !fresh.has(t)),
      batchSize,
      from,
    )) {
      try {
        await fetchTiles(batch, signal);
      } catch (err) {
        failed.push(...batch);
        error = err;
        // Out of time: the batches that arrived (the nearest) are what this search has.
        if (signal?.aborted) break;
      }
    }
    if (failed.length === 0) return;
    // Nearest tiles go first, so what did arrive is the part of the way that matters; nothing at all is an error.
    if (opts.cache.freshTiles(tiles, EVER).size === 0) throw error;
  }

  return {
    id: "osm",
    async search(area: SearchArea, categories: readonly ErrandCategory[], at: Date, signal?: AbortSignal) {
      const tiles = tilesAround(area.lat, area.lon, area.radius_m);
      await refresh(tiles, area, signal);
      const wanted = new Set(categories);
      const seen = new Set<string>();
      const found: Array<FoundPlace & { d: number }> = [];
      for (const p of opts.cache.placesIn(tiles)) {
        if (seen.has(p.key)) continue;
        seen.add(p.key);
        const category = categories.find((c) => p.categories.includes(c));
        if (!category || !p.categories.some((c) => wanted.has(c))) continue;
        const d = distanceM(area, p);
        if (d > area.radius_m) continue;
        const hours = evaluateHours(p.opening_hours, at, opts.timeZone);
        found.push({
          key: p.key,
          name: p.name,
          lat: p.lat,
          lon: p.lon,
          address: p.address,
          category,
          categories: p.categories,
          brand: p.brand,
          opening_hours: p.opening_hours,
          open: hours?.open,
          closes_soon: hours?.closes_soon,
          source: "osm",
          d,
        });
      }
      return found.sort((a, b) => a.d - b.d).map(({ d: _d, ...place }) => place);
    },
  };
}
