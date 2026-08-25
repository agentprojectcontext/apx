import test from "node:test";
import assert from "node:assert/strict";
import {
  _resetMobilityStateForTest,
  mobilityContext,
  mobilityContextBlock,
  mobilityQuestionIsRecent,
  observeMobilityEvent,
  recordMobilityQuestion,
  recordMobilityResponse,
} from "../src/core/mobility/state.js";

test.beforeEach(() => _resetMobilityStateForTest());

test("Roby retains current trip plus last mobility exchange", () => {
  observeMobilityEvent({
    type: "trip.started",
    trip_id: "trip-1",
    destination: "Onelli 444",
    occurred_at: "2026-08-21T20:00:00.000Z",
  }, 1_000);
  recordMobilityQuestion("¿Pasás por La Anónima?", 2_000);
  recordMobilityResponse("no", 3_000);

  const state = mobilityContext();
  assert.equal(state.trip.active, true);
  assert.equal(state.trip.destination, "Onelli 444");
  assert.equal(state.last_question.text, "¿Pasás por La Anónima?");
  assert.equal(state.last_response.action, "no");
  assert.match(mobilityContextBlock(), /No anuncies el viaje ni repitas preguntas/);
});

test("recent question suppresses another automatic mobility message", () => {
  recordMobilityQuestion("¿Vas al supermercado?", 10_000);
  assert.equal(mobilityQuestionIsRecent(10_000 + 19 * 60_000), true);
  assert.equal(mobilityQuestionIsRecent(10_000 + 20 * 60_000), false);
});

test("trip end remains available as secretary context", () => {
  observeMobilityEvent({ type: "trip.started", trip_id: "trip-1", destination: "Centro" }, 1_000);
  observeMobilityEvent({ type: "trip.ended", trip_id: "trip-1", occurred_at: "2026-08-21T21:00:00.000Z" }, 2_000);
  assert.equal(mobilityContext().trip.active, false);
});
