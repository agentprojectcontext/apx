import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { register } from "../src/host/daemon/api/mobility.js";
import {
  _resetMobilityEventsForTest,
  acceptMobilityEvent,
  mobilityPrompt,
  isMobilityTripActive,
} from "../src/core/mobility/trip-event.js";

test.beforeEach(() => _resetMobilityEventsForTest());

test("mobility event normalizes endpoints and deduplicates event id", () => {
  const body = {
    event_id: "trip-1",
    trip_id: "journey-1",
    type: "trip.started",
    destination: "La Anónima de Albarracín",
    origin: { latitude: -24.78, longitude: -65.41, accuracy_m: 20, age_ms: 500 },
  };
  const first = acceptMobilityEvent(body, 1_000);
  assert.equal(first.destination, "La Anónima de Albarracín");
  assert.equal(first.trip_id, "journey-1");
  assert.equal(isMobilityTripActive("journey-1"), true);
  assert.deepEqual(first.origin, {
    latitude: -24.78,
    longitude: -65.41,
    accuracy_m: 20,
    age_ms: 500,
  });
  assert.equal(acceptMobilityEvent(body, 1_001).duplicate, true);
  assert.match(mobilityPrompt(first), /esto no obliga a enviar mensaje/);
});

test("trip end cancels a pending mobility delivery", () => {
  acceptMobilityEvent({ event_id: "start", trip_id: "journey", type: "trip.started" }, 1_000);
  assert.equal(isMobilityTripActive("journey"), true);
  acceptMobilityEvent({ event_id: "end", trip_id: "journey", type: "trip.ended" }, 1_001);
  assert.equal(isMobilityTripActive("journey"), false);
});

test("state-only trip updates Roby's context without evaluation", async () => {
  const event = acceptMobilityEvent({
    event_id: "context-only",
    trip_id: "journey-context",
    type: "trip.started",
    destination: "Onelli 444",
    evaluate: false,
  }, 2_000);
  assert.equal(event.evaluate, false);
  assert.equal(isMobilityTripActive("journey-context"), true);
});

test("POST /mobility/events acknowledges before dispatching configured workflow", async () => {
  let resolveDispatch;
  const dispatched = new Promise((resolve) => { resolveDispatch = resolve; });
  const app = express();
  app.use(express.json());
  const api = express.Router();
  register(api, {
    mobilityDispatch: async (event) => resolveDispatch(event),
  });
  app.use("/api", api);
  const server = app.listen(0);
  try {
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/mobility/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        event_id: "trip-http",
        type: "trip.started",
        destination: "Centro",
      }),
    });
    assert.equal(response.status, 202);
    assert.equal((await response.json()).accepted, true);
    assert.equal((await dispatched).destination, "Centro");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("POST /mobility/positions validates before it acknowledges", async () => {
  const app = express();
  app.use(express.json());
  const api = express.Router();
  register(api, { mobilityPositionDispatch: async () => {} });
  app.use("/api", api);
  const server = app.listen(0);
  try {
    const url = `http://127.0.0.1:${server.address().port}/api/mobility/positions`;
    const bad = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ latitude: -41.13, longitude: -71.31 }),
    });
    assert.equal(bad.status, 400);
    assert.match((await bad.json()).error, /trip_id required/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("POST /mobility/positions acknowledges before evaluating proximity", async () => {
  let resolveDispatch;
  const dispatched = new Promise((resolve) => { resolveDispatch = resolve; });
  const app = express();
  app.use(express.json());
  const api = express.Router();
  register(api, { mobilityPositionDispatch: async (position) => resolveDispatch(position) });
  app.use("/api", api);
  const server = app.listen(0);
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/mobility/positions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        trip_id: "journey-gps",
        latitude: -41.1335,
        longitude: -71.3103,
        accuracy_m: 12,
        speed_mps: 11.4,
      }),
    });
    assert.equal(response.status, 202);
    assert.equal((await response.json()).trip_id, "journey-gps");
    const position = await dispatched;
    assert.equal(position.latitude, -41.1335);
    assert.equal(position.speed_mps, 11.4);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("a trip that ended stops earning proximity alerts", async () => {
  const { dispatchMobilityPosition } = await import("../src/core/mobility/trip-event.js");
  acceptMobilityEvent({ event_id: "s", trip_id: "gone", type: "trip.started" }, 1_000);
  acceptMobilityEvent({ event_id: "e", trip_id: "gone", type: "trip.ended" }, 1_001);
  const result = await dispatchMobilityPosition(
    { trip_id: "gone", latitude: -41.1335, longitude: -71.3103 },
    { projects: { list: () => [] } }
  );
  assert.deepEqual(result, { skipped: true, reason: "trip-ended" });
});
