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
