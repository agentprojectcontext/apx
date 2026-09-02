import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8");
const java = (name) => read("src", "interfaces", "android", "app", "src", "main", "java", "dev", "agentprojectcontext", "apx", `${name}.java`);

test("the battery exemption is offered from the native menu and never taken", () => {
  const manifest = read("src", "interfaces", "android", "app", "src", "main", "AndroidManifest.xml");
  const activity = java("MainActivity");

  assert.match(manifest, /android\.permission\.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS/);
  assert.match(activity, /"✓ Batería sin restricciones"/);
  assert.match(activity, /"Quitar restricción de batería"/);
  // Asking is a dialog the owner answers, so the app reports the real state
  // instead of assuming it, and sends them to the list once exempt — that is
  // the screen where the exemption can be taken back.
  assert.match(activity, /power\.isIgnoringBatteryOptimizations\(getPackageName\(\)\)/);
  assert.match(activity, /Settings\.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS/);
  assert.match(activity, /Settings\.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS/);
  // Some OEM builds ship neither screen: fall back, never crash on a missing
  // activity.
  assert.match(activity, /Settings\.ACTION_APPLICATION_DETAILS_SETTINGS/);
});

test("the mascot asks for a frame only while something is moving", () => {
  const view = java("MascotView");

  // The overlay sits above whatever the owner is doing all day. A frame is a
  // full software redraw, so a perpetual postInvalidateDelayed(32) was thirty
  // of them a second, forever, for a blob that was standing still.
  assert.doesNotMatch(view, /postInvalidateDelayed\(32\);/);
  assert.match(view, /boolean lively = dragging \|\| hopping \|\| message != null;/);
  assert.match(view, /postInvalidateDelayed\(lively \? FRAME_MS : untilNextBlinkFrame\(now\)\);/);
  // At rest the pose is held — no walk, no bob, no tilt, no wandering eyes —
  // and the only wake-up left is the blink.
  assert.match(view, /float walk = dragging \|\| !lively \? 0 :/);
  assert.match(view, /private static long untilNextBlinkFrame\(long now\)/);
});

test("the embedded /mobile stops running when it is off screen", () => {
  const activity = java("MainActivity");

  // onPause() alone only stops drawing; pauseTimers() is what stops the
  // JavaScript, and without it a full React app kept running behind the
  // launcher for as long as the process lived.
  assert.match(activity, /webView\.onPause\(\);/);
  assert.match(activity, /webView\.pauseTimers\(\);/);
  assert.match(activity, /webView\.onResume\(\);/);
  assert.match(activity, /webView\.resumeTimers\(\);/);
});

test("the daemon socket costs battery on a trip, and relaxes off one", () => {
  const manifest = read("src", "interfaces", "android", "app", "src", "main", "AndroidManifest.xml");
  const service = java("MascotOverlayService");

  assert.match(manifest, /android\.permission\.ACCESS_NETWORK_STATE/);
  // Two ceilings, because a dropped socket is worth seconds on a drive and
  // minutes when the daemon is simply not addressable from where the phone is.
  assert.match(service, /TRIP_MAX_BACKOFF_MS = 15_000L/);
  assert.match(service, /IDLE_MAX_BACKOFF_MS = 5 \* 60_000L/);
  assert.match(service, /preferences\.travelActive\(\) \? TRIP_MAX_BACKOFF_MS : IDLE_MAX_BACKOFF_MS/);
  // With no network there is nothing to dial: wait for the callback rather
  // than climb a ladder that cannot succeed.
  assert.match(service, /registerDefaultNetworkCallback\(networkCallback\)/);
  assert.match(service, /if \(!networkUp\(\)\) \{/);
  assert.match(service, /connectivity\.getActiveNetwork\(\) != null/);
  // Opening a trip must not wait out an idle backoff.
  assert.match(service, /MapsNavigationListenerService\.ACTION_TRAVEL_STATE_CHANGED/);
  assert.match(service, /unregisterNetworkCallback\(networkCallback\)/);
});
