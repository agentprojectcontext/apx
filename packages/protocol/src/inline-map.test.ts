import assert from "node:assert/strict";
import { test } from "node:test";
import { mapFrame } from "./inline-map.ts";

const cafes = [
  { lat: -34.6037, lng: -58.3816 },
  { lat: -34.6045, lng: -58.3822 },
  { lat: -34.5967, lng: -58.3813 },
  { lat: -34.6125, lng: -58.3804 },
];

test("a street map holds every place inside the frame, at a street zoom, with tiles covering it", () => {
  const frame = mapFrame(cafes);
  assert.ok(frame.zoom >= 13 && frame.zoom <= 16, `zoom ${frame.zoom}`);
  const at = cafes.map((p) => frame.at(p));
  for (const { x, y } of at) assert.ok(x > 5 && x < 95 && y > 10 && y < 95, `${x},${y}`);
  const tall = Math.max(...at.map((p) => p.y)) - Math.min(...at.map((p) => p.y));
  assert.ok(tall > 45, `the places fill the frame (${tall}% tall)`);
  const tiles = frame.tiles("dark");
  assert.ok(tiles.every((t) => t.url.startsWith("https://") && t.url.includes("/World_Dark_Gray_Base/")));
  assert.ok(tiles.some((t) => t.left <= 0 && t.top <= 0));
  assert.ok(tiles.some((t) => t.left + t.width >= 100 && t.top + t.height >= 100));
  assert.ok(
    mapFrame(cafes)
      .tiles("light")
      .every((t) => t.url.includes("/World_Light_Gray_Base/")),
  );
});

test("one place gets a close view, far apart places a wide one", () => {
  assert.equal(mapFrame([cafes[0] as { lat: number; lng: number }]).zoom, 16);
  const far = mapFrame([
    { lat: -34.6, lng: -58.38 },
    { lat: -41.13, lng: -71.31 },
  ]);
  assert.ok(far.zoom < 8, `zoom ${far.zoom}`);
});
