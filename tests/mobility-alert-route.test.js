// POST /api/mobility/alerts/:id/answer — the native card's half of the round
// trip, and the reason the alert no longer depends on Telegram: the card is
// pushed over the events socket and answered here, so an install with no
// Telegram plugin has a complete loop.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Own sandbox before the modules load — mobility state persists under ~/.apx.
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "apx-mobroute-"));
process.env.APX_HOME = path.join(tmpHome, ".apx");
process.env.HOME = tmpHome;
fs.mkdirSync(process.env.APX_HOME, { recursive: true });

const { ProjectManager } = await import("#host/daemon/db.js");
const { buildApi } = await import("#host/daemon/api.js");
const { recordMobilityAlert, getMobilityAlert, _resetMobilityStateForTest } =
  await import("#core/mobility/state.js");

const TOKEN = "mobility-route-token";
let server;
let baseUrl;

const ALERT = {
  trip_id: "trip1",
  task_id: "task1",
  task: "Comprar ibuprofeno",
  project_id: "0",
  place: "Farmacia del Puente",
  address: "Av. San Martín 1234",
  latitude: -41.13,
  longitude: -71.31,
  distance_m: 900,
};

const answer = (id, action) =>
  fetch(`${baseUrl}/api/mobility/alerts/${id}/answer`, {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ action }),
  });

before(async () => {
  const projects = new ProjectManager({});
  projects.registerDefault();
  const app = buildApi({
    projects,
    registries: null,
    plugins: { instances: new Map(), get: () => null, status: () => ({}) },
    scheduler: null,
    version: "9.9.9",
    startedAt: Date.now(),
    addProjectGlobally: () => {},
    config: { host: "127.0.0.1", port: 7430 },
    token: TOKEN,
  });
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch { /* gone */ }
});

beforeEach(() => _resetMobilityStateForTest());

test("a tap on the car card records the same answer a Telegram chip does", async () => {
  const alert = recordMobilityAlert(ALERT);
  const res = await answer(alert.id, "navigate");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.ok);
  assert.ok(body.ack, "the car shows the acknowledgement as a toast");
  // "Navegar ahora" IS "voy": the driver did not promise to go, they started
  // going, so the end-of-trip follow-up has something to ask about.
  assert.equal(getMobilityAlert(alert.id).answer, "go");
});

test("'No ahora' is recorded as skip, which the one-shot turns into silence", async () => {
  const alert = recordMobilityAlert(ALERT);
  assert.equal((await answer(alert.id, "skip")).status, 200);
  const stored = getMobilityAlert(alert.id);
  assert.equal(stored.answer, "skip");
  assert.equal(stored.outcome, "skipped");
});

test("'Para después' declines the place and leaves the errand owed a reminder", async () => {
  const alert = recordMobilityAlert(ALERT);
  assert.equal((await answer(alert.id, "next")).status, 200);
  assert.equal(getMobilityAlert(alert.id).outcome, "skipped_place");
});

test("an unknown action is a 400 and an unknown alert is a 404", async () => {
  const alert = recordMobilityAlert(ALERT);
  const bad = await answer(alert.id, "destroy");
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /action must be one of/);

  assert.equal((await answer("nope", "go")).status, 404);
  // Nothing was recorded by either.
  assert.equal(getMobilityAlert(alert.id).answer, null);
});

test("the route needs a token like every other data route", async () => {
  const alert = recordMobilityAlert(ALERT);
  const res = await fetch(`${baseUrl}/api/mobility/alerts/${alert.id}/answer`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "go" }),
  });
  assert.equal(res.status, 401);
});

test("'done' answers without a task to close, and says which it was", async () => {
  // The alert names project 0, whose task ids are real; a made-up one cannot be
  // closed, and the record has to say so rather than claiming success.
  const alert = recordMobilityAlert({ ...ALERT, task_id: "t_nothere" });
  assert.equal((await answer(alert.id, "done")).status, 200);
  assert.equal(getMobilityAlert(alert.id).outcome, "done_unlinked");
});
