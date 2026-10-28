import assert from "node:assert/strict";
import { test } from "node:test";
import { flowGraphMethods } from "./flow-graph.ts";

test("discard requires explicit true confirmation, a Flow and a positive CAS version", () => {
  const schema = flowGraphMethods["flows.draft_discard"].params;
  for (const confirm of [undefined, false, "true"]) {
    assert.equal(schema.safeParse({ flow: "inbox", expectedVersion: 1, confirm }).success, false);
  }
  for (const expectedVersion of [undefined, null, 0, -1]) {
    assert.equal(schema.safeParse({ flow: "inbox", expectedVersion, confirm: true }).success, false);
  }
  assert.deepEqual(schema.parse({ flow: "inbox", expectedVersion: 3, confirm: true }), {
    flow: "inbox",
    expectedVersion: 3,
    confirm: true,
  });
});
