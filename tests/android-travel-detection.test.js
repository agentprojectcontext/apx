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
  const eventGate = read("src", "interfaces", "android", "app", "src", "main", "java", "dev", "agentprojectcontext", "apx", "TravelEventGate.java");
  const banner = read("src", "interfaces", "android", "app", "src", "main", "java", "dev", "agentprojectcontext", "apx", "TravelStatusBanner.java");

  assert.match(manifest, /android\.permission\.BIND_NOTIFICATION_LISTENER_SERVICE/);
  assert.match(manifest, /android\.intent\.action\.SEND/);
  assert.match(manifest, /Compartir viaje con APX/);
  assert.match(activity, /Settings\.ACTION_NOTIFICATION_LISTENER_SETTINGS/);
  assert.match(activity, /MapsShareIntentParser\.isGoogleMapsShare/);
  assert.match(activity, /Viaje compartido con APX/);
  assert.match(detector, /com\.google\.android\.apps\.maps/);
  assert.match(detector, /"navigation"\.equals\(category\)/);
  assert.match(listener, /REMOVAL_DEBOUNCE_MS/);
  assert.match(listener, /ROUTE_POLL_INTERVAL_MS/);
  assert.match(listener, /scheduleRoutePoll/);
  assert.match(listener, /matchesActiveRoute/);
  assert.match(listener, /ProgressStyle/);
  assert.match(listener, /stale Maps navigation shell/);
  assert.match(listener, /NAVIGATION_SIGNAL_TIMEOUT_MS/);
  assert.match(listener, /item\.getPostTime\(\)/);
  assert.match(listener, /CarMessageNotification\.cancel/);
  assert.match(listener, /TravelEventGate\.coolingDown/);
  assert.match(eventGate, /KNOWN_DESTINATION_SETTLE_MS = 45_000L/);
  assert.match(eventGate, /UNKNOWN_DESTINATION_SETTLE_MS = 10 \* 60_000L/);
  assert.match(eventGate, /SAME_DESTINATION_COOLDOWN_MS = 30 \* 60_000L/);
  assert.match(listener, /daemonNotificationPending/);
  assert.match(listener, /notifyTripEnded/);
  assert.match(listener, /previousDestination/);
  assert.match(listener, /sharing location without inventing destination/);
  assert.match(listener, /CarMessageNotification\.showDestinationRequest/);
  assert.match(listener, /destination changed; APX started a new trip/);
  assert.match(banner, /Estás navegando por una ruta/);
  assert.match(banner, /Abrir Maps/);
});
