import assert from "node:assert/strict";
import { test } from "node:test";
import { chosenRefs, helperPatch, helperValue, readHelper } from "./helperModel.ts";

test("no value is automatic", () => {
  assert.deepEqual(readHelper(undefined), { mode: "auto", refs: [] });
  assert.deepEqual(readHelper(""), { mode: "auto", refs: [] });
  assert.deepEqual(readHelper("  "), { mode: "auto", refs: [] });
});

test("off is off", () => {
  assert.deepEqual(readHelper("off"), { mode: "off", refs: [] });
});

test("one model is a chain of one", () => {
  assert.deepEqual(readHelper("ollama/qwen2.5:14b"), { mode: "pick", refs: ["ollama/qwen2.5:14b"] });
});

test("a comma chain keeps its order, without blanks, spaces or repeats", () => {
  assert.deepEqual(readHelper("chatgpt/gpt-6-luna,ollama/qwen3:4b-instruct"), {
    mode: "pick",
    refs: ["chatgpt/gpt-6-luna", "ollama/qwen3:4b-instruct"],
  });
  assert.deepEqual(readHelper(" b/x , ,a/y,b/x,"), { mode: "pick", refs: ["b/x", "a/y"] });
});

test("only commas is automatic", () => {
  assert.deepEqual(readHelper(", ,"), { mode: "auto", refs: [] });
});

test("a chain is saved first model first; an empty one is automatic", () => {
  assert.equal(
    helperValue(["chatgpt/gpt-6-luna", "ollama/qwen3:4b-instruct"]),
    "chatgpt/gpt-6-luna,ollama/qwen3:4b-instruct",
  );
  assert.equal(helperValue([]), undefined);
  assert.deepEqual(readHelper(helperValue(["a/1", "b/2"])), { mode: "pick", refs: ["a/1", "b/2"] });
});

const CHAIN = "chatgpt/gpt-6-luna,ollama/qwen3:4b-instruct";
const REFS = ["chatgpt/gpt-6-luna", "ollama/qwen3:4b-instruct"];

test("the chosen list is the live chain while Chosen is on, else the one kept", () => {
  assert.deepEqual(chosenRefs({ aux_model: CHAIN }), REFS);
  assert.deepEqual(chosenRefs({ aux_model: CHAIN, aux_chain: "a/1" }), REFS);
  assert.deepEqual(chosenRefs({ aux_chain: CHAIN }), REFS);
  assert.deepEqual(chosenRefs({ aux_model: "off", aux_chain: CHAIN }), REFS);
  assert.deepEqual(chosenRefs({}), []);
});

test("Automatic and Off keep the chosen list; Chosen brings it back", () => {
  assert.deepEqual(helperPatch("auto", REFS), { aux_chain: CHAIN });
  assert.deepEqual(helperPatch("off", REFS), { aux_model: "off", aux_chain: CHAIN });
  assert.deepEqual(helperPatch("pick", REFS), { aux_model: CHAIN, aux_chain: CHAIN });
  // A list emptied in Chosen runs as Automatic and keeps nothing.
  assert.deepEqual(helperPatch("pick", []), { aux_chain: "" });
  // Round trip: Chosen → Automatic → Chosen gives the same models back.
  const back = chosenRefs(helperPatch("auto", chosenRefs({ aux_model: CHAIN })));
  assert.deepEqual(helperPatch("pick", back), { aux_model: CHAIN, aux_chain: CHAIN });
});
