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
  ensureTripPlan,
  ensureTripTargets,
  lockTripErrand,
  tripPlaces,
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

function givenTask(title, extra = {}) {
  return createTask(storagePath, { title, ...extra });
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

test("an errand added mid-drive is picked up on the very next sample", async () => {
  // The place cache is keyed on how far you have travelled, which is right for
  // places and wrong for tasks: a "buy ibuprofen" added from the phone at a red
  // light was invisible for the rest of the trip, because the empty set had
  // already been cached before the task existed.
  //
  // The first fix was a ten-minute timer, which was still wrong in both
  // directions — it paid for a search every ten minutes on a drive where
  // nothing changed, and STILL hid a new errand for up to ten of them. What
  // expires the plan now is the errand list itself, which is a local file read.
  const position = acceptMobilityPosition({ trip_id: "trip-late", ...DRIVING_AT });
  const search = fakeSearch([{ query: "farmacia", name: "Farmacia Ejemplo", ...PHARMACY }]);

  assert.deepEqual(await ensureTripTargets(position, ctx, search), [], "nothing pending yet");

  givenTask("Comprar ibuprofeno en la farmacia");
  const targets = await ensureTripTargets(position, ctx, search);
  assert.equal(targets.length, 1, "same second, same place — but the list changed");
  assert.equal(targets[0].place, "Farmacia Ejemplo");
});

test("a drive where nothing changes costs exactly one place search", async () => {
  // The whole economic argument for the plan. Fifty GPS samples along a road
  // must not be fifty Nominatim queries — or, with a paid provider, fifty
  // billable calls.
  givenTask("Comprar ibuprofeno en la farmacia");
  let searches = 0;
  const search = async (url) => {
    searches += 1;
    return fakeSearch([{ query: "farmacia", name: "Farmacia Ejemplo", ...PHARMACY }])(url);
  };
  for (let step = 0; step < 50; step += 1) {
    await evaluateMobilityPosition(
      // Creeping ~11 m per sample: half a kilometre of road, nowhere near the
      // 8 km that earns a fresh search.
      acceptMobilityPosition({
        trip_id: "trip-cheap",
        latitude: DRIVING_AT.latitude + step * 0.0001,
        longitude: DRIVING_AT.longitude,
      }),
      ctx,
      search
    );
  }
  assert.equal(searches, 1, "one search for the whole drive");
});

test("an errand with several shops follows the driver until it is settled", async () => {
  // "Buy bread" is not a place, it is a choice between places. Re-ranking that
  // choice as the car moves is arithmetic on numbers already in hand; only
  // re-deciding by SEARCHING again would cost anything.
  givenTask("Comprar pan en el supermercado");
  const search = fakeSearch([
    { query: "supermercado", name: "La Anónima", latitude: -41.1450, longitude: -71.3103 },
    { query: "supermercado", name: "Todo", latitude: -41.1200, longitude: -71.3103 },
  ]);
  const near = (latitude) => acceptMobilityPosition({ trip_id: "trip-bread", latitude, longitude: -71.3103 });

  let plan = await ensureTripPlan(near(-41.1420), ctx, search);
  const [errand] = [...plan.values()];
  assert.equal(errand.candidates.length, 2, "both shops stay on the books");
  assert.equal(errand.chosen.place, "La Anónima", "the nearest one from here");
  assert.equal(errand.locked, false);

  // Drive north, past the other one.
  plan = await ensureTripPlan(near(-41.1220), ctx, search);
  assert.equal([...plan.values()][0].chosen.place, "Todo", "the choice follows the car");

  // …until the owner answers "voy", which is the last word on which shop.
  assert.equal(lockTripErrand("trip-bread", errand.task_id, "accepted"), true);
  plan = await ensureTripPlan(near(-41.1420), ctx, search);
  assert.equal([...plan.values()][0].chosen.place, "Todo", "a settled errand does not re-open");
  assert.equal([...plan.values()][0].lock_reason, "accepted");
});

test("a settled plan stops searching even when the road keeps going", async () => {
  // The terminal state the owner asked for: "unless we already have one single
  // place to go". One candidate IS the decision, so there is nothing left that
  // another search could change — not even eight kilometres later.
  givenTask("Comprar ibuprofeno en la farmacia");
  let searches = 0;
  const search = async (url) => {
    searches += 1;
    return fakeSearch([{ query: "farmacia", name: "Farmacia Ejemplo", ...PHARMACY }])(url);
  };
  const trip = "trip-settled";
  await ensureTripPlan(acceptMobilityPosition({ trip_id: trip, ...DRIVING_AT }), ctx, search);
  assert.equal(searches, 1);
  // 30 km down the road — far past RETARGET_DISTANCE_M.
  await ensureTripPlan(
    acceptMobilityPosition({ trip_id: trip, latitude: -41.4000, longitude: -71.3103 }),
    ctx,
    search
  );
  assert.equal(searches, 1, "the only candidate is the answer; distance cannot change it");
});

test("a settled errand still comes into range as the car approaches it", async () => {
  // The bug this pins: settling an errand froze its DISTANCE along with its
  // place. Every plan is warmed at the origin (trip-event.js prepareTripPlan)
  // and a pinned errand locks on sight, so the frozen number was "how far the
  // shop is from where I set off" — and it stayed that for the whole drive.
  // The driver pulled up outside the pharmacy and heard nothing.
  givenTask("Comprar ibuprofeno", {
    category: "trip",
    location: { place: "Farmacia Pioneros", latitude: PHARMACY.latitude, longitude: PHARMACY.longitude },
  });
  const noSearch = async () => { throw new Error("a pinned errand must not search"); };
  const at = (latitude) => acceptMobilityPosition({ trip_id: "trip-approach", latitude, longitude: -71.3103 });

  // Leaving home, ~9 km short of the pharmacy: nothing to say yet.
  assert.deepEqual(await evaluateMobilityPosition(at(-41.2150), ctx, noSearch), []);
  // Same trip, now ~170 m away. This is the reminder the feature exists for.
  const arriving = await evaluateMobilityPosition(at(-41.1450 - 0.0015), ctx, noSearch);
  assert.equal(arriving.length, 1, "arriving at a settled errand must alert");
  assert.equal(arriving[0].place, "Farmacia Pioneros");
  assert.ok(
    arriving[0].distance_m < PROXIMITY_RADIUS_M,
    `the alert must carry the distance from HERE, got ${arriving[0].distance_m}`
  );
});

test("the phone's list shows one row per errand, not one per shop", async () => {
  // The banner is a list of things to DO. Three supermarkets for one loaf is
  // one row that happens to name three options, not three rows.
  givenTask("Comprar pan en el supermercado");
  const search = fakeSearch([
    { query: "supermercado", name: "La Anónima", latitude: -41.1450, longitude: -71.3103 },
    { query: "supermercado", name: "Todo", latitude: -41.1200, longitude: -71.3103 },
  ]);
  await ensureTripPlan(acceptMobilityPosition({ trip_id: "trip-list", ...DRIVING_AT }), ctx, search);
  const rows = tripPlaces("trip-list");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].options, 2, "the row says the choice is still open");
  assert.equal(rows[0].locked, false);
  assert.match(rows[0].maps_url, /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&destination=/);
});

test("a trip task with its own place needs no search and no model", async () => {
  // This is what the `trip` category buys: the errand already knows where it
  // is, so the alert costs zero network and zero tokens. A fetch call here is
  // the regression.
  givenTask("Comprar ibuprofeno en la farmacia del Km 8", {
    category: "trip",
    location: { place: "Farmacia Pioneros Km 8", latitude: PHARMACY.latitude, longitude: PHARMACY.longitude },
  });
  let searched = 0;
  const alerts = await evaluateMobilityPosition(
    acceptMobilityPosition({ trip_id: "trip-pinned", ...DRIVING_AT }),
    ctx,
    async () => { searched += 1; return { ok: true, status: 200, json: async () => [] }; }
  );
  assert.equal(searched, 0, "a pinned errand must not cost a place search");
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].place, "Farmacia Pioneros Km 8");
  assert.equal(alerts[0].need_id, "pinned");
});

test("a task's own radius wins over the default", async () => {
  // 1.3 km away, but this errand only wants to hear about it inside 500 m.
  givenTask("Pasar por la ferretería", {
    category: "trip",
    location: {
      place: "Ferretería Ejemplo",
      latitude: PHARMACY.latitude,
      longitude: PHARMACY.longitude,
      radius_m: 500,
    },
  });
  const alerts = await evaluateMobilityPosition(
    acceptMobilityPosition({ trip_id: "trip-tight", ...DRIVING_AT }),
    ctx,
    async () => { throw new Error("must not search"); }
  );
  assert.deepEqual(alerts, [], "inside the default radius but outside its own");
});

test("a place is only kept when there is something usable in it", async () => {
  const { normalizeTaskLocation, normalizeTaskCategory } =
    await import("../src/core/constants/task-categories.js");
  assert.equal(normalizeTaskLocation(null), null);
  assert.equal(normalizeTaskLocation({}), null);
  // Half a coordinate is worse than none — everything downstream would read it
  // as an answer.
  assert.equal(normalizeTaskLocation({ latitude: -41.1 }), null);
  assert.deepEqual(normalizeTaskLocation({ place: "Farmacia" }), { place: "Farmacia" });
  assert.deepEqual(
    normalizeTaskLocation({ lat: -41.1, lng: -71.3 }),
    { latitude: -41.1, longitude: -71.3 }
  );
  assert.equal(normalizeTaskLocation({ latitude: 999, longitude: -71.3 }), null);
  assert.equal(normalizeTaskCategory("TRIP"), "trip");
  assert.equal(normalizeTaskCategory("nonsense"), "general");
  assert.equal(normalizeTaskCategory(undefined), "general");
});
