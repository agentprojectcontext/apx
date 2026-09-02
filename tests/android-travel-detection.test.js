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

test("Android Auto is a second trip source, and it never fires on an invitation", () => {
  const manifest = read("src", "interfaces", "android", "app", "src", "main", "AndroidManifest.xml");
  const detector = read("src", "interfaces", "android", "app", "src", "main", "java", "dev", "agentprojectcontext", "apx", "AndroidAutoDetector.java");
  const listener = read("src", "interfaces", "android", "app", "src", "main", "java", "dev", "agentprojectcontext", "apx", "MapsNavigationListenerService.java");
  const preferences = read("src", "interfaces", "android", "app", "src", "main", "java", "dev", "agentprojectcontext", "apx", "ApxPreferences.java");

  // Scoped to the projection app, and gated on a PERSISTENT notification whose
  // text is not an offer to set Android Auto up.
  assert.match(detector, /com\.google\.android\.projection\.gearhead/);
  assert.match(detector, /if \(!persistent\) return false;/);
  assert.match(detector, /OFFER_TERMS/);
  assert.match(detector, /RUNNING_TERMS/);
  assert.match(detector, /DEVELOPER_TERMS/);
  // The real session notification carries FOREGROUND_SERVICE and no
  // ONGOING_EVENT; folding only one of the flags detected nothing on a real
  // phone, which is the whole feature.
  assert.match(listener, /FLAG_ONGOING_EVENT \| Notification\.FLAG_FOREGROUND_SERVICE/);

  // Both sources are tracked independently and the trip outlives either one.
  assert.match(listener, /private boolean mapsNavigating;/);
  assert.match(listener, /private boolean autoConnected;/);
  assert.match(listener, /observeProjection/);
  assert.match(listener, /endMapsNavigation/);
  assert.match(listener, /the Android Auto session keeps the trip open/);
  assert.match(preferences, /SOURCE_ANDROID_AUTO/);
  assert.match(manifest, /com\.google\.android\.gms\.car\.application/);
});

test("trip GPS runs as a location-typed foreground service, only while a trip is on", () => {
  const manifest = read("src", "interfaces", "android", "app", "src", "main", "AndroidManifest.xml");
  const service = read("src", "interfaces", "android", "app", "src", "main", "java", "dev", "agentprojectcontext", "apx", "TripLocationService.java");
  const client = read("src", "interfaces", "android", "app", "src", "main", "java", "dev", "agentprojectcontext", "apx", "DaemonClient.java");
  const listener = read("src", "interfaces", "android", "app", "src", "main", "java", "dev", "agentprojectcontext", "apx", "MapsNavigationListenerService.java");

  assert.match(manifest, /android\.permission\.FOREGROUND_SERVICE_LOCATION/);
  assert.match(manifest, /android:foregroundServiceType="location"/);
  // Background location is exactly what the foreground service exists to
  // avoid asking for — a regression here is a permission the owner never
  // agreed to.
  assert.doesNotMatch(manifest, /uses-permission[^>]*ACCESS_BACKGROUND_LOCATION/);

  assert.match(service, /FOREGROUND_SERVICE_TYPE_LOCATION/);
  assert.match(service, /MIN_UPLOAD_INTERVAL_MS/);
  assert.match(service, /if \(!preferences\.travelActive\(\)\)/);
  assert.match(client, /\/api\/mobility\/positions/);
  assert.match(client, /accuracy_m/);
  // Started and stopped by the trip itself, not by a screen or a user tap.
  assert.match(listener, /TripLocationService\.start\(this, tripId\)/);
  assert.match(listener, /TripLocationService\.stop\(this\)/);
});
