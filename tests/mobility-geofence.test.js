// Live proximity alerts: the one-shot guarantee, the radius, and the chips.
//
// The behaviour under test is a promise to a driver — "you will hear about a
// place once, when you are near it, and never again on this trip". Everything
// here is offline: the place search is an injected fetch, so no test depends
// on Nominatim being up or on where the machine running it happens to be.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "apx-geofence-"));
process.env.APX_HOME = path.join(tmpHome, ".apx");
process.env.HOME = tmpHome;
process.env.USERPROFILE = tmpHome;

const {
  PROXIMITY_RADIUS_M,
  _resetMobilityGeofencesForTest,
  acceptMobilityPosition,
  addToRouteUrl,
  evaluateMobilityPosition,
  followupKeyboard,
  followupMessage,
  navigateUrl,
  proximityKeyboard,
  proximityMessage,
} = await import("../src/core/mobility/geofence.js");
const {
  _resetMobilityStateForTest,
  getMobilityAlert,
  pendingMobilityFollowups,
  recordMobilityAlert,
  updateMobilityAlert,
} = await import("../src/core/mobility/state.js");

// Bariloche. The pharmacy sits ~1.3 km from the sampled position (inside the
// 2 km radius) and the supermarket ~9 km away (well outside it), so one fires
// and one does not without either number being borderline.
const DRIVING_AT = { latitude: -41.1335, longitude: -71.3103 };
const PHARMACY = { latitude: -41.1450, longitude: -71.3103 };
const FAR_SUPERMARKET = { latitude: -41.2150, longitude: -71.3103 };

/**
 * A real (temporary) project store. The geofence reads tasks through the
 * normal event-log projection, so the tasks here are written the way the app
 * writes them rather than stubbed at the module boundary — ESM exports cannot
 * be redefined, and a fake projection would stop testing the status filter
 * that decides whether an errand is still pending.
 */
const storagePath = path.join(tmpHome, "store", "acme");
const projects = {
  list: () => [{ id: "0", name: "acme", storagePath }],
  get: () => ({ id: "0", name: "acme", storagePath }),
};
const ctx = { projects };

const { createTask, doneTask } = await import("../src/core/stores/tasks.js");

function givenTask(title) {
  return createTask(storagePath, { title });
}

/**
 * Stand-in for Nominatim. The real client asks one query per need and reads
 * `lat`/`lon`/`display_name`, so that is all this returns.
 */
function fakeSearch(places) {
  return async (url) => {
    const query = decodeURIComponent(new URL(url).searchParams.get("q") || "");
    const rows = places
      .filter((place) => place.query === query)
      .map((place) => ({
        lat: String(place.latitude),
        lon: String(place.longitude),
        display_name: `${place.name}, Bariloche, Argentina`,
      }));
    return { ok: true, status: 200, json: async () => rows };
  };
}

test.beforeEach(() => {
  _resetMobilityGeofencesForTest();
  _resetMobilityStateForTest();
  fs.rmSync(path.join(storagePath, "tasks"), { recursive: true, force: true });
});

test.after(() => fs.rmSync(tmpHome, { recursive: true, force: true }));

test("a GPS sample is rejected without a trip or with impossible coordinates", () => {
  assert.throws(() => acceptMobilityPosition({ latitude: -41.1, longitude: -71.3 }), /trip_id required/);
  assert.throws(() => acceptMobilityPosition({ trip_id: "t" }), /latitude and longitude required/);
  assert.throws(
    () => acceptMobilityPosition({ trip_id: "t", latitude: 120, longitude: -71.3 }),
    /latitude out of range/
  );
  const position = acceptMobilityPosition({
    trip_id: "t", latitude: -41.1335, longitude: -71.3103, accuracy_m: "18",
  }, 1_000);
  assert.equal(position.accuracy_m, 18);
  assert.equal(position.source, "android");
});

test("a pending errand within the radius alerts exactly once per trip", async () => {
  givenTask("Comprar ibuprofeno en la farmacia");
  const fetchFn = fakeSearch([{ query: "farmacia", name: "Farmacia Ejemplo", ...PHARMACY }]);
  const position = acceptMobilityPosition({ trip_id: "trip-a", ...DRIVING_AT });

  const first = await evaluateMobilityPosition(position, ctx, fetchFn);
  assert.equal(first.length, 1);
  assert.equal(first[0].place, "Farmacia Ejemplo");
  assert.ok(first[0].distance_m < PROXIMITY_RADIUS_M, `expected < ${PROXIMITY_RADIUS_M}, got ${first[0].distance_m}`);

  // A candidate that was never delivered stays available — evaluating twice
  // without recording must not silently spend the reminder.
  const undelivered = await evaluateMobilityPosition(
    acceptMobilityPosition({ trip_id: "trip-a", ...DRIVING_AT }), ctx, fetchFn
  );
  assert.equal(undelivered.length, 1, "an un-sent candidate is not a delivered reminder");

  // Once it IS delivered, three more samples produce nothing.
  recordMobilityAlert(first[0]);
  for (let i = 0; i < 3; i += 1) {
    const again = await evaluateMobilityPosition(
      acceptMobilityPosition({ trip_id: "trip-a", ...DRIVING_AT }),
      ctx,
      fetchFn
    );
    assert.deepEqual(again, [], "a delivered reminder must never fire again on the same trip");
  }
});

test("one errand is one reminder, however many shops could satisfy it", async () => {
  // A real drive through Bariloche matched thirteen pharmacies to a single
  // "buy ibuprofen" task and sent eight Telegram messages in ninety seconds.
  // The nearest shop is the answer; the other twelve are noise.
  givenTask("Comprar ibuprofeno en la farmacia");
  const alerts = await evaluateMobilityPosition(
    acceptMobilityPosition({ trip_id: "trip-many", ...DRIVING_AT }),
    ctx,
    fakeSearch([
      { query: "farmacia", name: "Farmacia Lejos", latitude: -41.1500, longitude: -71.3103 },
      { query: "farmacia", name: "Farmacia Cerca", latitude: -41.1350, longitude: -71.3103 },
      { query: "farmacia", name: "Farmacia Media", latitude: -41.1420, longitude: -71.3103 },
    ])
  );
  assert.equal(alerts.length, 1, "one errand, one card");
  assert.equal(alerts[0].place, "Farmacia Cerca", "and it names the nearest one");
});

test("a place outside the radius stays silent", async () => {
  givenTask("Hacer las compras en el supermercado");
  const alerts = await evaluateMobilityPosition(
    acceptMobilityPosition({ trip_id: "trip-b", ...DRIVING_AT }),
    ctx,
    fakeSearch([{ query: "supermercado", name: "Supermercado Lejano", ...FAR_SUPERMARKET }])
  );
  assert.deepEqual(alerts, []);
});

test("a trip with no physical errand never reaches the place search", async () => {
  givenTask("Revisar el informe trimestral");
  let called = 0;
  const alerts = await evaluateMobilityPosition(
    acceptMobilityPosition({ trip_id: "trip-c", ...DRIVING_AT }),
    ctx,
    async () => { called += 1; return { ok: true, status: 200, json: async () => [] }; }
  );
  assert.deepEqual(alerts, []);
  assert.equal(called, 0, "a desk task must not cost a network round trip");
});

test("a completed task is not a pending errand", async () => {
  const task = givenTask("Comprar ibuprofeno en la farmacia");
  doneTask(storagePath, task.id);
  const alerts = await evaluateMobilityPosition(
    acceptMobilityPosition({ trip_id: "trip-d", ...DRIVING_AT }),
    ctx,
    fakeSearch([{ query: "farmacia", name: "Farmacia Ejemplo", ...PHARMACY }])
  );
  assert.deepEqual(alerts, []);
});

test("the chips carry navigation, a stop on the current route, and both answers", async () => {
  givenTask("Pasar por la farmacia");
  const [alert] = await evaluateMobilityPosition(
    acceptMobilityPosition({ trip_id: "trip-e", ...DRIVING_AT }),
    ctx,
    fakeSearch([{ query: "farmacia", name: "Farmacia Ejemplo", ...PHARMACY }])
  );

  recordMobilityAlert(alert);
  const message = proximityMessage(alert, "es");
  assert.match(message, /Farmacia Ejemplo/);
  assert.match(message, /1\.\d km/);
  assert.match(message, /Tarea: Pasar por la farmacia/);

  const recorded = getMobilityAlert(recordMobilityAlert(alert).id);
  const keyboard = proximityKeyboard(recorded, { destination: "Onelli 444", lang: "es" });
  const [links, answers] = keyboard.inline_keyboard;
  assert.equal(links[0].url, navigateUrl(recorded));
  assert.match(links[1].url, /waypoints=/);
  assert.match(links[1].url, /destination=Onelli%20444/);
  assert.equal(answers[0].callback_data, `apx:mobility:go:${recorded.id}`);
  assert.equal(answers[1].callback_data, `apx:mobility:skip:${recorded.id}`);

  // No destination known → the "add a stop" link degrades to plain navigation
  // instead of inventing a route.
  assert.equal(addToRouteUrl(alert, ""), navigateUrl(alert));
});

test("only a yes earns a follow-up, and answering it closes the loop", async () => {
  givenTask("Pasar por la farmacia");
  const [alert] = await evaluateMobilityPosition(
    acceptMobilityPosition({ trip_id: "trip-f", ...DRIVING_AT }),
    ctx,
    fakeSearch([{ query: "farmacia", name: "Farmacia Ejemplo", ...PHARMACY }])
  );

  const stored = recordMobilityAlert(alert);
  assert.deepEqual(pendingMobilityFollowups("trip-f"), [], "unanswered alerts are not promises");

  updateMobilityAlert(stored.id, { answer: "skip", outcome: "skipped" });
  assert.deepEqual(pendingMobilityFollowups("trip-f"), [], "a no is not a promise either");

  updateMobilityAlert(stored.id, { answer: "go", outcome: null });
  const pending = pendingMobilityFollowups("trip-f");
  assert.equal(pending.length, 1);
  assert.match(followupMessage(pending[0], "es"), /¿Pasaste por Farmacia Ejemplo\?/);
  assert.equal(followupKeyboard(pending[0], "es").inline_keyboard[0][0].callback_data, `apx:mobility:done:${stored.id}`);

  // Asked once. The follow-up stamp is what stops it being asked on every
  // later trip for the rest of the week.
  updateMobilityAlert(stored.id, { followup_at: new Date().toISOString() });
  assert.deepEqual(pendingMobilityFollowups("trip-f"), []);
  assert.equal(getMobilityAlert(stored.id).answer, "go");
});
