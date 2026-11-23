// What the model reads when a confirm card is not approved: an expired one ends that call, never the turn.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { InputRecord } from "../domain/inputs.ts";
import { unanswered } from "./executor.ts";

const card = (state: InputRecord["state"]) => ({ state, answer: undefined }) as unknown as InputRecord;

test("a confirm card that expired is a 'not run' the agent can act on", () => {
  const r = unanswered(card("expired"));
  assert.match(r?.text ?? "", /^not run: the owner did not answer in time\./);
  assert.match(r?.text ?? "", /continue without it/);
});

test("a declined card is a 'not run', an approved one is not", () => {
  assert.match(unanswered(card("denied"))?.text ?? "", /^not run: the owner declined/);
  assert.equal(unanswered(card("approved")), undefined);
});
