// Agent `Model:` field: `inherit` is a marker, never a provider id. A real
// `provider:model` forces that engine. A chat override only wins when it is a
// real id — empty/`inherit` from the picker means "use the agent's card".

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  agentForcedModel,
  isInheritedModel,
  resolveAgentModel,
} from "#core/agent/agent-model.js";

const agent = (model) => ({ fields: { Model: model } });

test("isInheritedModel: absent, empty and the inherit marker", () => {
  assert.equal(isInheritedModel(null), true);
  assert.equal(isInheritedModel(undefined), true);
  assert.equal(isInheritedModel(""), true);
  assert.equal(isInheritedModel("  "), true);
  assert.equal(isInheritedModel("inherit"), true);
  assert.equal(isInheritedModel("Inherit"), true);
  assert.equal(isInheritedModel("groq:llama-3.3-70b-versatile"), false);
});

test("agentForcedModel: inherit and empty yield no override", () => {
  assert.equal(agentForcedModel(agent("inherit")), "");
  assert.equal(agentForcedModel(agent("")), "");
  assert.equal(agentForcedModel({ fields: {} }), "");
  assert.equal(agentForcedModel(agent("groq:llama-3.3-70b-versatile")), "groq:llama-3.3-70b-versatile");
});

test("resolveAgentModel: a real chat override wins over inherit on the card", async () => {
  const model = await resolveAgentModel({
    agent: agent("inherit"),
    override: "groq:llama-3.3-70b-versatile",
  });
  assert.equal(model, "groq:llama-3.3-70b-versatile");
});

test("resolveAgentModel: inherit/empty chat picker keeps the agent's forced model", async () => {
  const forced = "openrouter:openai/gpt-oss-20b";
  assert.equal(await resolveAgentModel({ agent: agent(forced), override: "inherit" }), forced);
  assert.equal(await resolveAgentModel({ agent: agent(forced), override: "" }), forced);
  assert.equal(await resolveAgentModel({ agent: agent(forced) }), forced);
});
