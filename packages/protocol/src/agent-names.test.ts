import assert from "node:assert/strict";
import { test } from "node:test";
import { AGENT_NAMES, randomAgentName } from "./constants.ts";

test("a random agent name avoids the names given, whatever their case", () => {
  const taken = AGENT_NAMES.slice(1).map((n) => n.toUpperCase());
  for (let i = 0; i < 20; i++) assert.equal(randomAgentName(taken), AGENT_NAMES[0]);
  assert.notEqual(randomAgentName(AGENT_NAMES[0]), AGENT_NAMES[0]);
});

test("once every name is taken, a name with a number that is not taken either", () => {
  const all = [...AGENT_NAMES, ...AGENT_NAMES.map((n) => `${n} 2`)];
  assert.match(randomAgentName(all), /^\S+ 3$/);
});
