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

    // Automatic and Off keep the chosen list apart, so Chosen can bring it back.
    const { aux_model: _a, ...auto } = settings;
    await env.client.call("memory.set_settings", { ...auto, aux_chain: chain });
    const kept = await env.client.call("memory.settings", {});
    assert.equal(kept.aux_model, undefined);
    assert.equal(kept.aux_chain, chain);
    await env.client.call("memory.set_settings", { ...auto, aux_model: "off", aux_chain: chain });
    assert.deepEqual(upkeep.auxModels(), []);
    assert.equal((await env.client.call("memory.settings", {})).aux_chain, chain);
    // Another screen saving memory without the list leaves it as it was.
    const { aux_chain: _c, ...other } = await env.client
      .call("memory.settings", {})
      .then(({ indexed: _i2, total: _t2, embedder: _e2, ...x }) => x);
    await env.client.call("memory.set_settings", { ...other, auto_compact: false });
    assert.equal((await env.client.call("memory.settings", {})).aux_chain, chain);
  } finally {
    await upkeep.stop();
    await env.core.close();
    await env.cleanup();
  }
});

test("a deletion's judge asks only the helper list's first model, never a fallback (DECISIONS.md#d-281)", async () => {
  let fail = false;
  const llm = scriptedLlm(() => {
    if (fail) throw new Error("the first model is down");
    return say('{"decision":"run"}');
  });
  const env = await startCore({ llm });
  const upkeep = createUpkeep({ store: env.core.store, llm, log: createLog("test", true) });
  try {
    env.core.store.settings.set("model_aux", "chatgpt/gpt-6-luna,ollama/qwen3:4b-instruct");
    const answer = await upkeep.decide("Decide", "A deletion", { purpose: "deletion" }, 20_000);
    assert.equal(answer?.text, '{"decision":"run"}');
    assert.deepEqual(llm.calls.at(-1)?.models, ["chatgpt/gpt-6-luna"]);
    // The first one failing is no answer: the judge's caller shows the card.
    fail = true;
    const before = llm.calls.length;
    await assert.rejects(upkeep.decide("Decide", "A deletion", { purpose: "deletion" }, 20_000));
    assert.deepEqual(
      llm.calls.slice(before).map((c) => c.models),
      [["chatgpt/gpt-6-luna"]],
    );
    env.core.store.settings.set("model_aux", "off");
    assert.equal(await upkeep.decide("Decide", "A deletion", { purpose: "deletion" }), undefined);
  } finally {
    await upkeep.stop();
    await env.core.close();
    await env.cleanup();
  }
});
