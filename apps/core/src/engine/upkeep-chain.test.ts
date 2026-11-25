import assert from "node:assert/strict";
import { test } from "node:test";
import { createLog } from "../log.ts";
import { say, scriptedLlm, startCore } from "./testkit.ts";
import { createUpkeep } from "./upkeep.ts";

test("the helper chain the panel saves is tried in order, five long refs included", async () => {
  const llm = scriptedLlm(() => say("yes"));
  const env = await startCore({ llm });
  const upkeep = createUpkeep({ store: env.core.store, llm, log: createLog("test", true) });
  try {
    const refs = [
      "chatgpt/gpt-6-luna",
      "ollama/qwen3:4b-instruct",
      "openrouter/nvidia/llama-3.3-nemotron-super-49b-v1.5:free",
      "openrouter/mistralai/mistral-small-3.2-24b-instruct:free",
      "openrouter/deepseek/deepseek-r1-distill-llama-70b:free",
    ];
    const chain = refs.join(",");
    assert.ok(chain.length > 200);
    const { indexed: _i, total: _t, embedder: _e, ...settings } = await env.client.call("memory.settings", {});
    await env.client.call("memory.set_settings", { ...settings, aux_model: chain });
    assert.equal((await env.client.call("memory.settings", {})).aux_model, chain);
    assert.deepEqual(upkeep.auxModels(), refs);

    assert.equal(await upkeep.judge("Is it worth it?", "A message", { purpose: "mail" }), "yes");
    assert.deepEqual(llm.calls.at(-1)?.models, refs);

    // Saving with no helper model goes back to automatic; "off" turns background work off.
    const { aux_model: _a, ...auto } = settings;
    await env.client.call("memory.set_settings", auto);
    assert.equal((await env.client.call("memory.settings", {})).aux_model, undefined);
    await env.client.call("memory.set_settings", { ...auto, aux_model: "off" });
    assert.deepEqual(upkeep.auxModels(), []);
  } finally {
    await upkeep.stop();
    await env.core.close();
    await env.cleanup();
  }
});
