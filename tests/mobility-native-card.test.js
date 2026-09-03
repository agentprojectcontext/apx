// The native proximity card: what Android draws on the phone and on the head
// unit, and what Assistant reads out loud.
//
// Three properties this file exists to hold:
//   1. it carries the exact street address, not only a distance;
//   2. it carries NO emoji, because the car reads it aloud;
//   3. it does not depend on Telegram.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "apx-mobcard-"));
process.env.APX_HOME = path.join(tmpHome, ".apx");
process.env.HOME = tmpHome;

const { PROXIMITY_ACTIONS, proximityCard, proximityMessage, navigateUrl } =
  await import("#core/mobility/geofence.js");
const { answerMobilityAlert, MOBILITY_ANSWERS } = await import("#core/mobility/answer.js");
const {
  recordMobilityAlert, getMobilityAlert, mobilityAlertFired, _resetMobilityStateForTest,
} = await import("#core/mobility/state.js");

const ALERT = {
  trip_id: "t1",
  task_id: "task1",
  task: "Comprar ibuprofeno",
  project_id: "0",
  place: "Farmacia del Puente",
  address: "Av. San Martín 1234, Bariloche, Río Negro",
  latitude: -41.13,
  longitude: -71.31,
  distance_m: 1400,
};

beforeEach(() => _resetMobilityStateForTest());

// Anything Assistant would pronounce as a Unicode name. A "📍" read aloud
// mid-sentence is the exact failure this guards.
const EMOJI = /\p{Extended_Pictographic}/u;

test("the errand leads, then where it is, then the exact address", () => {
  const card = proximityCard(recordMobilityAlert(ALERT), { lang: "es" });
  assert.equal(card.address, "Av. San Martín 1234, Bariloche, Río Negro");
  // Whatever is heard first has to answer "do I care?", and that is the
  // errand — not the shop, and not how far away it is.
  assert.ok(card.body.startsWith("Comprar ibuprofeno."), card.body);
  assert.equal(card.title, "Comprar ibuprofeno");
  assert.equal(card.place, "Farmacia del Puente");
  assert.ok(
    card.body.indexOf("Farmacia del Puente") < card.body.indexOf("Av. San Martín 1234"),
    "the shop comes before the door to aim at",
  );

  // Spoken units, not screen ones: "1.4 km" is read as a letter and an English
  // decimal point by a Spanish voice. The compact form stays for the UI chip.
  assert.match(card.body, /1,4 kilómetros/);
  assert.equal(card.distance_label, "1.4 km");

  // No "Dirección:" / "Tarea:" labels out loud — that is two filler words per
  // line before the content. The Telegram copy keeps them; it is read.
  assert.ok(!/Dirección|Tarea:/.test(card.body), card.body);
  // One full stop per sentence. "mobility.near" ends with its own and the
  // other lines do not, so a plain join produced "(1.4 km).." — which a speech
  // engine reads as a pause twice as long as it should be.
  assert.ok(!/\.\./.test(card.body), card.body);
});

test("nothing on the card carries an emoji — the car reads it out loud", () => {
  const card = proximityCard(recordMobilityAlert(ALERT), { lang: "es" });
  assert.ok(!EMOJI.test(card.body), `body speaks an emoji: ${card.body}`);
  assert.ok(!EMOJI.test(card.title), `title speaks an emoji: ${card.title}`);
  for (const action of card.actions) {
    assert.ok(!EMOJI.test(action.label), `action "${action.id}" speaks an emoji: ${action.label}`);
  }
});

test("the Telegram message keeps its glyphs — that one is read with the eyes", () => {
  const message = proximityMessage(recordMobilityAlert(ALERT), "es");
  assert.ok(EMOJI.test(message));
  // And it gained the address too.
  assert.match(message, /Dirección: Av\. San Martín 1234/);
});

test("the card offers exactly the four answers, in order, with both Maps links", () => {
  const card = proximityCard(recordMobilityAlert(ALERT), { destination: "Onelli 444", lang: "es" });
  assert.deepEqual(card.actions.map((a) => a.id), ["navigate", "add_stop", "next", "skip"]);
  assert.deepEqual(
    card.actions.map((a) => a.label),
    ["Navegar ahora", "Sumar a la ruta", "Para después", "No ahora"],
  );
  assert.equal(card.navigate_url, navigateUrl(card));
  // "Sumar a la ruta" keeps the trip's destination and inserts the place.
  assert.match(card.add_stop_url, /waypoints=/);
  assert.match(card.add_stop_url, /destination=Onelli%20444/);
  assert.deepEqual(PROXIMITY_ACTIONS.map((a) => a.id), ["navigate", "add_stop", "next", "skip"]);
});

test("a card with no address says less rather than inventing one", () => {
  const card = proximityCard(recordMobilityAlert({ ...ALERT, address: null }), { lang: "es" });
  assert.equal(card.address, null);
  assert.ok(!/Dirección/.test(card.body));
  assert.match(card.body, /Farmacia del Puente/);
});

// ── the answers ─────────────────────────────────────────────────────────────

test("navigate and add_stop are 'voy' — the driver did not promise, they left", () => {
  for (const action of ["navigate", "add_stop", "go"]) {
    _resetMobilityStateForTest();
    const alert = recordMobilityAlert(ALERT);
    const result = answerMobilityAlert(alert.id, action, { lang: "es" });
    assert.ok(result.ok, action);
    // All three land on the same recorded answer, so the end-of-trip follow-up
    // asks about a tap on the car card exactly as it does about a Telegram yes.
    assert.equal(getMobilityAlert(alert.id).answer, "go", action);
  }
});

test("'No ahora' puts the errand away for the whole trip", () => {
  const alert = recordMobilityAlert(ALERT);
  answerMobilityAlert(alert.id, "skip", { lang: "es" });
  assert.equal(getMobilityAlert(alert.id).answer, "skip");
  assert.equal(getMobilityAlert(alert.id).outcome, "skipped");
  // The one-shot is what makes it stick: announced, so nothing asks again on
  // this trip. A new trip has a new id and starts clean.
  assert.equal(mobilityAlertFired("t1", "task1"), true);
  assert.equal(mobilityAlertFired("t2", "task1"), false);
});

test("'Para después' leaves the errand owed a reminder at the next shop", () => {
  const alert = recordMobilityAlert(ALERT);
  answerMobilityAlert(alert.id, "next", { lang: "es" });
  assert.equal(getMobilityAlert(alert.id).outcome, "skipped_place");
  // NOT announced — a different branch later in the drive can still speak up.
  assert.equal(mobilityAlertFired("t1", "task1"), false);
});

test("'done' closes the task through the caller, and says so when it cannot", () => {
  const alert = recordMobilityAlert(ALERT);
  const closed = answerMobilityAlert(alert.id, "done", { lang: "es", closeTask: () => true });
  assert.ok(closed.ok);
  assert.equal(getMobilityAlert(alert.id).outcome, "done");

  _resetMobilityStateForTest();
  const second = recordMobilityAlert(ALERT);
  // No closer supplied (or the task is gone) — recorded, but honest about it.
  answerMobilityAlert(second.id, "done", { lang: "es" });
  assert.equal(getMobilityAlert(second.id).outcome, "done_unlinked");
});

test("an unknown alert or an unknown action is refused, not guessed", () => {
  const alert = recordMobilityAlert(ALERT);
  assert.equal(answerMobilityAlert("nope", "go").reason, "unknown-alert");
  assert.equal(answerMobilityAlert(alert.id, "destroy").reason, "unknown-action");
  assert.ok(MOBILITY_ANSWERS.includes("skip"));
});

// ── the trip-start card ─────────────────────────────────────────────────────
// Source-level, like tests/android-travel-detection.test.js: the card is built
// inside an agent run, and what is worth pinning is which controls it offers —
// not that a model produced prose.

test("the trip-start card offers one control and asks nothing", () => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  const source = fs.readFileSync(path.join(root, "src/core/mobility/trip-event.js"), "utf8");
  const card = source.slice(source.indexOf("ONE CONTROL, NOT A QUESTION"));

  // "No avisar más hoy" is the one thing with no equivalent anywhere else.
  assert.match(card, /apx:mobility:silence/);
  // The old question is gone. `yes` and `no` returned an acknowledgement and
  // changed no state; "recordarme luego" postponed the whole trip, which "Para
  // después" now does per errand and better.
  assert.ok(!/callback_data: "apx:mobility:yes"/.test(card), "«Sí, voy ahora» is back on the trip card");
  assert.ok(!/callback_data: "apx:mobility:no"/.test(card), "«No podré» is back on the trip card");
  assert.ok(!/callback_data: "apx:mobility:later"/.test(card), "«Recordarme luego» is back on the trip card");
});

test("the retired trip answers are still handled for cards already in a chat", () => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  const handler = fs.readFileSync(
    path.join(root, "src/core/channels/telegram/ask-callbacks.js"), "utf8",
  );
  // Removing them from the keyboard must not turn the ones already sitting in
  // the chat history into buttons that answer nothing.
  assert.match(handler, /action === "yes" \|\| action === "no"/);
  assert.match(handler, /action === "later"/);
});

// ── where a reminder is delivered ───────────────────────────────────────────
// It used to be "Telegram, always", because Telegram was the only surface that
// could draw buttons. Now the phone draws them natively, so the Telegram copy
// was a second notification for the same event — which is how a chat used for
// everything else fills up with driving reminders.

test("mobility reminders go to the app by default, not to Telegram", async () => {
  const { mobilitySurfaces } = await import("#core/mobility/preferences.js");
  assert.deepEqual(mobilitySurfaces({}), { app: true, telegram: false });
  assert.deepEqual(mobilitySurfaces(undefined), { app: true, telegram: false });
});

test("the owner can put them on Telegram, both, or neither", async () => {
  const { mobilitySurfaces } = await import("#core/mobility/preferences.js");
  const at = (notify) => mobilitySurfaces({ mobility: { notify } });
  assert.deepEqual(at("telegram"), { app: false, telegram: true });
  assert.deepEqual(at("both"), { app: true, telegram: true });
  assert.deepEqual(at(["app", "telegram"]), { app: true, telegram: true });
  // "none" turns driving reminders off without unpairing anything.
  assert.deepEqual(at("none"), { app: false, telegram: false });
  assert.deepEqual(at([]), { app: false, telegram: false });
});

test("a typo falls back to the default rather than delivering nowhere", async () => {
  const { mobilitySurfaces } = await import("#core/mobility/preferences.js");
  // Silently disabling the alerts because a config file says "telegran" is the
  // worst possible reading of it.
  assert.deepEqual(mobilitySurfaces({ mobility: { notify: "telegran" } }), { app: true, telegram: false });
  assert.deepEqual(mobilitySurfaces({ mobility: { notify: 42 } }), { app: true, telegram: false });
});
