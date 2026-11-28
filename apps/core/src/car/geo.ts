// Small geodesy for errands on the way: distances, bearings and the geohash tiles the place cache is keyed by.
export type Point = { lat: number; lon: number };
export type Bbox = { south: number; west: number; north: number; east: number };

const EARTH_M = 6_371_008.8;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** Great-circle distance in metres (haversine). */
export function distanceM(a: Point, b: Point): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing from `a` to `b`, 0..360 (0 = north, 90 = east). */
export function bearingDeg(a: Point, b: Point): number {
  const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
  const x =
    Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) -
    Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/** The smaller angle between two headings, 0..180. */
export function angleDiff(a: number, b: number): number {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return d > 180 ? 360 - d : d;
}

const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";

export function geohash(lat: number, lon: number, precision: number): string {
  let latLo = -90;
  let latHi = 90;
  let lonLo = -180;
  let lonHi = 180;
  let out = "";
  let bits = 0;
  let ch = 0;
  let even = true;
  while (out.length < precision) {
    if (even) {
      const mid = (lonLo + lonHi) / 2;
      if (lon >= mid) {
        ch = (ch << 1) | 1;
        lonLo = mid;
      } else {
        ch <<= 1;
        lonHi = mid;
      }
    } else {
      const mid = (latLo + latHi) / 2;
      if (lat >= mid) {
        ch = (ch << 1) | 1;
        latLo = mid;
      } else {
        ch <<= 1;
        latHi = mid;
      }
    }
    even = !even;
    if (++bits === 5) {
      out += BASE32[ch];
      bits = 0;
      ch = 0;
    }
  }
  return out;
}

/** The cell a geohash names. Throws on a character outside the geohash alphabet. */
export function geohashBbox(hash: string): Bbox {
  let latLo = -90;
  let latHi = 90;
  let lonLo = -180;
  let lonHi = 180;
  let even = true;
  for (const c of hash) {
    const v = BASE32.indexOf(c);
    if (v < 0) throw new Error(`not a geohash: ${hash}`);
    for (let bit = 4; bit >= 0; bit--) {
      const on = (v >> bit) & 1;
      if (even) {
        const mid = (lonLo + lonHi) / 2;
        if (on) lonLo = mid;
        else lonHi = mid;
      } else {
        const mid = (latLo + latHi) / 2;
        if (on) latLo = mid;
        else latHi = mid;
      }
      even = !even;
    }
  }
  return { south: latLo, west: lonLo, north: latHi, east: lonHi };
}

const wrapLon = (lon: number) => ((((lon + 180) % 360) + 360) % 360) - 180;

/** The 8 cells around a geohash (fewer at the poles). */
export function geohashNeighbours(hash: string): string[] {
  const b = geohashBbox(hash);
  const dLat = b.north - b.south;
  const dLon = b.east - b.west;
  const cLat = (b.north + b.south) / 2;
  const cLon = (b.east + b.west) / 2;
  const out: string[] = [];
  for (const dy of [1, 0, -1]) {
    for (const dx of [-1, 0, 1]) {
      if (dx === 0 && dy === 0) continue;
      const lat = cLat + dy * dLat;
      if (lat > 90 || lat < -90) continue;
      const h = geohash(lat, wrapLon(cLon + dx * dLon), hash.length);
      if (h !== hash && !out.includes(h)) out.push(h);
    }
  }
  return out;
}

/** The widest circle tilesAround covers (about 140 geohash-6 cells at mid latitudes). */
export const MAX_TILE_RADIUS_M = 5_000;
export const TILE_PRECISION = 6;

/** Geohash-6 cells that touch a circle, nearest first. The radius is capped at MAX_TILE_RADIUS_M. */
export function tilesAround(lat: number, lon: number, radius_m: number): string[] {
  const r = Math.min(Math.max(radius_m, 0), MAX_TILE_RADIUS_M);
  const center = { lat, lon };
  const start = geohashBbox(geohash(lat, lon, TILE_PRECISION));
  const dLat = start.north - start.south;
  const dLon = start.east - start.west;
  const latSpan = deg(r / EARTH_M);
  const lonSpan = latSpan / Math.max(Math.cos(rad(lat)), 0.01);
  const rows = Math.ceil(latSpan / dLat) + 1;
  const cols = Math.ceil(lonSpan / dLon) + 1;
  const found = new Map<string, number>();
  for (let y = -rows; y <= rows; y++) {
    for (let x = -cols; x <= cols; x++) {
      const cLat = (start.north + start.south) / 2 + y * dLat;
      if (cLat > 90 || cLat < -90) continue;
      const cLon = wrapLon((start.east + start.west) / 2 + x * dLon);
      const hash = geohash(cLat, cLon, TILE_PRECISION);
      if (found.has(hash)) continue;
      const b = geohashBbox(hash);
      const nearest = {
        lat: Math.min(Math.max(lat, b.south), b.north),
        lon: Math.min(Math.max(lon, b.west), b.east),
      };
      const d = distanceM(center, nearest);
      if (d <= r) found.set(hash, d);
    }
  }
  return [...found.entries()].sort((a, b) => a[1] - b[1]).map(([h]) => h);
}

/** The box around several cells. */
export function bboxOf(hashes: readonly string[]): Bbox {
  const boxes = hashes.map(geohashBbox);
  return {
    south: Math.min(...boxes.map((b) => b.south)),
    west: Math.min(...boxes.map((b) => b.west)),
    north: Math.max(...boxes.map((b) => b.north)),
    east: Math.max(...boxes.map((b) => b.east)),
  };
}
