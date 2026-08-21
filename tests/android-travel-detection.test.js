import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8");

test("Android trip detector is opt-in and scoped to Google Maps navigation", () => {
  const manifest = read("src", "interfaces", "android", "app", "src", "main", "AndroidManifest.xml");
  const activity = read("src", "interfaces", "android", "app", "src", "main", "java", "dev", "agentprojectcontext", "apx", "MainActivity.java");
  const detector = read("src", "interfaces", "android", "app", "src", "main", "java", "dev", "agentprojectcontext", "apx", "MapsNavigationDetector.java");
  const listener = read("src", "interfaces", "android", "app", "src", "main", "java", "dev", "agentprojectcontext", "apx", "MapsNavigationListenerService.java");
  const banner = read("src", "interfaces", "android", "app", "src", "main", "java", "dev", "agentprojectcontext", "apx", "TravelStatusBanner.java");

  assert.match(manifest, /android\.permission\.BIND_NOTIFICATION_LISTENER_SERVICE/);
  assert.match(activity, /Settings\.ACTION_NOTIFICATION_LISTENER_SETTINGS/);
  assert.match(detector, /com\.google\.android\.apps\.maps/);
  assert.match(detector, /"navigation"\.equals\(category\)/);
  assert.match(listener, /REMOVAL_DEBOUNCE_MS/);
  assert.match(listener, /EVENT_DELAY_MS/);
  assert.match(listener, /notifyTripEnded/);
  assert.match(listener, /previousDestination/);
  assert.match(listener, /pending destination; APX remains silent/);
  assert.match(listener, /destination changed; APX started a new trip/);
  assert.match(banner, /Estás navegando por una ruta/);
  assert.match(banner, /Abrir Maps/);
});
