import assert from "node:assert/strict";
import { test } from "node:test";
import {
  angleDiff,
  bearingDeg,
  distanceM,
  geohash,
  geohashBbox,
  geohashNeighbours,
  MAX_TILE_RADIUS_M,
  tilesAround,
} from "./geo.ts";

test("distanceM matches known distances", () => {
  // Buenos Aires Obelisco to Córdoba city centre: about 646 km.
  const d = distanceM({ lat: -34.6037, lon: -58.3816 }, { lat: -31.4201, lon: -64.1888 });
  assert.ok(Math.abs(d - 646_000) < 5_000, `got ${d}`);
  // One degree of latitude is about 111.2 km.
  assert.ok(Math.abs(distanceM({ lat: 0, lon: 0 }, { lat: 1, lon: 0 }) - 111_195) < 50);
  assert.equal(distanceM({ lat: 10, lon: 10 }, { lat: 10, lon: 10 }), 0);
});

test("bearingDeg points the right way", () => {
  assert.ok(Math.abs(bearingDeg({ lat: 0, lon: 0 }, { lat: 1, lon: 0 }) - 0) < 1e-9);
  assert.ok(Math.abs(bearingDeg({ lat: 0, lon: 0 }, { lat: 0, lon: 1 }) - 90) < 1e-9);
  assert.ok(Math.abs(bearingDeg({ lat: 0, lon: 0 }, { lat: -1, lon: 0 }) - 180) < 1e-9);
  assert.ok(Math.abs(bearingDeg({ lat: 0, lon: 0 }, { lat: 0, lon: -1 }) - 270) < 1e-9);
});

test("angleDiff is the smaller angle", () => {
  assert.equal(angleDiff(10, 350), 20);
  assert.equal(angleDiff(350, 10), 20);
  assert.equal(angleDiff(0, 180), 180);
  assert.equal(angleDiff(90, 90), 0);
  assert.equal(angleDiff(-90, 270), 0);
});

test("geohash encodes and decodes known cells", () => {
  assert.equal(geohash(57.64911, 10.40744, 11), "u4pruydqqvj");
  assert.equal(geohash(-34.6037, -58.3816, 6), "69y7pk");
  const b = geohashBbox("69y7pk");
  assert.ok(b.south <= -34.6037 && -34.6037 <= b.north && b.west <= -58.3816 && -58.3816 <= b.east);
  assert.throws(() => geohashBbox("69a"));
});

test("geohashNeighbours gives the 8 touching cells", () => {
  const n = geohashNeighbours("69y7pk");
  assert.equal(n.length, 8);
  assert.equal(new Set(n).size, 8);
  const c = geohashBbox("69y7pk");
  for (const h of n) {
    const b = geohashBbox(h);
    const touches =
      b.south <= c.north + 1e-9 && b.north >= c.south - 1e-9 && b.west <= c.east + 1e-9 && b.east >= c.west - 1e-9;
    assert.ok(touches, h);
  }
});

test("tilesAround covers the circle, nearest first, and caps the radius", () => {
  const small = tilesAround(-34.6037, -58.3816, 100);
  assert.equal(small[0], "69y7pk");
  const km = tilesAround(-34.6037, -58.3816, 1_000);
  assert.ok(km.length >= 6 && km.length <= 20, `${km.length}`);
  const wider = tilesAround(-34.6037, -58.3816, 1_500);
  for (const h of geohashNeighbours("69y7pk")) assert.ok(wider.includes(h), h);
  const capped = tilesAround(-34.6037, -58.3816, 50_000);
  assert.deepEqual(capped, tilesAround(-34.6037, -58.3816, MAX_TILE_RADIUS_M));
  assert.ok(capped.length < 200, `${capped.length}`);
});
