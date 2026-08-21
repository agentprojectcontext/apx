import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createTask } from "#core/stores/tasks.js";
import { enrichMobilityEvent, haversineMeters } from "#core/mobility/osm-route.js";

function json(value) {
  return { ok: true, json: async () => value };
}

test("OSM enrichment finds a compatible shop close to the computed route", async () => {
  const storagePath = fs.mkdtempSync(path.join(os.tmpdir(), "apx-mobility-osm-"));
  createTask(storagePath, {
    title: "Pasar por La Anónima del km 4 a comprar",
    tags: ["compras", "fisica", "movilidad"],
  });
  const project = { id: "default", name: "default", storagePath };
  const projects = { list: () => [project], get: () => project };
  const fetchFn = async (url) => {
    const target = String(url);
    if (target.includes("nominatim") && target.includes("La+An")) {
      return json([{ lat: "-41.155", lon: "-71.35", display_name: "La Anónima km 4, Bariloche" }]);
    }
    if (target.includes("nominatim")) return json([{ lat: "-41.15", lon: "-71.30", display_name: "Destino" }]);
    if (target.includes("valhalla")) return json({});
    if (target.includes("router.project-osrm")) return json({ routes: [{
      distance: 5000,
      duration: 600,
      geometry: { coordinates: [[-71.40, -41.16], [-71.35, -41.155], [-71.30, -41.15]] },
    }] });
    if (target.includes("overpass")) return json({ elements: [{
      type: "node", id: 1, lat: -41.155, lon: -71.35,
      tags: { name: "La Anónima km 4", shop: "supermarket" },
    }] });
    throw new Error(`unexpected URL ${target}`);
  };

  const result = await enrichMobilityEvent({
    destination: "Centro",
    origin: { latitude: -41.16, longitude: -71.40 },
  }, { projects }, fetchFn);

  assert.equal(result.checked, true);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].place, "La Anónima km 4");
  assert.match(result.candidates[0].maps_url, /google\.com\/maps\/search/);
});

test("haversine distance stays near known one-degree latitude distance", () => {
  const meters = haversineMeters({ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 });
  assert.ok(meters > 110_000 && meters < 112_000);
});
