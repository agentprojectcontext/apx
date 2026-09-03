// End-to-end proximity alert, against the RUNNING daemon.
//
//   node scripts/mobility-alert-e2e.mjs
//
// Files a located errand, opens a trip, reports a GPS position 600 m from it,
// and asserts the card that comes back on the events socket — the same frame
// the phone turns into a four-button notification and the head unit draws.
// Then answers it the way the car does, and checks the answer was recorded.
//
// A real drive in miniature, which is the point: the geofence, the address,
// the emoji stripping and the answer round trip only exist correctly when a
// whole trip runs through them.
//
// It cleans up after itself — the task is dropped and the trip ended — so it
// is safe against a live install. With a paired phone plugged in, the other
// half of the delivery can be watched landing:
//
//   adb shell dumpsys notification --noredact | grep -A3 apx_proximity
//
// which should show `category=navigation actions=4`.
import WebSocket from "ws";

const BASE = "http://127.0.0.1:7430";
const PLACE = { latitude: -41.1335, longitude: -71.3103 };   // Bariloche centre
// ~600 m away: inside the 2 km proximity radius, not on top of it.
const CAR = { latitude: -41.1389, longitude: -71.3103 };

const token = await (await fetch(`${BASE}/api/admin/web-token`)).json().then((b) => b.token);
const H = { authorization: `Bearer ${token}`, "content-type": "application/json" };
const api = async (path, init) => {
  const res = await fetch(`${BASE}/api${path}`, { ...init, headers: H });
  const body = await res.text();
  return { status: res.status, body: body ? JSON.parse(body) : null };
};

const log = (...a) => console.log("[e2e]", ...a);
const tripId = `e2e-trip-${Date.now()}`;
let taskId = null;

// 1. A located errand, exactly the shape the geofence takes a shortcut for:
//    category "trip" + pinned coordinates means no place search, no model.
const created = await api("/projects/0/tasks", {
  method: "POST",
  body: JSON.stringify({
    title: "[e2e movilidad] Comprar ibuprofeno",
    category: "trip",
    location: { place: "Farmacia del Puente", address: "Av. San Martín 1234, Bariloche", ...PLACE },
    source: "e2e",
  }),
});
taskId = created.body.id;
log("task", taskId, "→", created.body.location);

// 2. Listen before triggering, or the frame races the subscription.
const ws = new WebSocket(`${BASE.replace("http", "ws")}/api/events/ws?token=${encodeURIComponent(token)}`);
const alertSeen = new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("no mobility_alert frame within 30s")), 30_000);
  ws.on("message", (raw) => {
    let frame;
    try { frame = JSON.parse(raw.toString()); } catch { return; }
    if (frame.type !== "mobility_alert") return;
    clearTimeout(timer);
    resolve(frame.alert);
  });
  ws.on("error", reject);
});
await new Promise((r) => ws.on("open", r));
log("socket open");

// 3. The trip starts, then the car reports a position near the errand.
log("trip.started →", (await api("/mobility/events", {
  method: "POST",
  body: JSON.stringify({ event_id: `${tripId}-start`, trip_id: tripId, type: "trip.started", destination: "Onelli 444", origin: CAR }),
})).status);

log("position →", (await api("/mobility/positions", {
  method: "POST",
  body: JSON.stringify({ trip_id: tripId, ...CAR, accuracy_m: 12, source: "e2e" }),
})).status);

// 4. The card.
const alert = await alertSeen;
ws.close();
console.log("\n=== mobility_alert ===");
console.log(JSON.stringify(alert, null, 2));

const problems = [];
if (!alert.address) problems.push("no address on the card");
if (!/Av\. San Martín 1234/.test(alert.body || "")) problems.push("address missing from the spoken body");
if (!/\d/.test(alert.distance_label || "")) problems.push("no distance");
if (/\p{Extended_Pictographic}/u.test(alert.body || "")) problems.push("body speaks an emoji");
const ids = (alert.actions || []).map((a) => a.id).join(",");
if (ids !== "navigate,add_stop,next,skip") problems.push(`actions are "${ids}"`);
for (const action of alert.actions || []) {
  if (/\p{Extended_Pictographic}/u.test(action.label)) problems.push(`action ${action.id} speaks an emoji`);
}
if (!alert.navigate_url?.includes("destination=")) problems.push("no navigate url");
if (!alert.add_stop_url?.includes("waypoints=")) problems.push("add_stop is not a waypoint");

// 5. Answer it the way the car does.
const answered = await api(`/mobility/alerts/${alert.id}/answer`, {
  method: "POST", body: JSON.stringify({ action: "navigate" }),
});
log("answer navigate →", answered.status, JSON.stringify(answered.body?.ack));
if (answered.status !== 200) problems.push(`answer route returned ${answered.status}`);
if (answered.body?.alert?.answer !== "go") problems.push(`answer recorded as ${answered.body?.alert?.answer}`);

const bad = await api(`/mobility/alerts/${alert.id}/answer`, {
  method: "POST", body: JSON.stringify({ action: "destroy" }),
});
if (bad.status !== 400) problems.push(`an unknown action returned ${bad.status}, not 400`);

// 6. Put everything back.
await api("/mobility/events", {
  method: "POST",
  body: JSON.stringify({ event_id: `${tripId}-end`, trip_id: tripId, type: "trip.ended" }),
});
if (taskId) await api(`/projects/0/tasks/${taskId}/drop`, { method: "POST", body: "{}" });
log("cleaned up");

if (problems.length) {
  console.error("\n✖ " + problems.join("\n✖ "));
  process.exit(1);
}
console.log("\n✔ card, address, four emoji-free actions and the answer round trip all check out");
