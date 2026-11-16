import assert from "node:assert/strict";
import { test } from "node:test";
import { createLog } from "../log.ts";
import { say, scriptedLlm, startCore } from "./testkit.ts";
import { createUpkeep } from "./upkeep.ts";

for (const model of ["ollama/gemma3n:e4b", "google/gemma-3n-e4b-it", "groq/qwen/qwen3.8-27b"]) {
  test(`auxiliary image analysis keeps ${model} eligible`, async () => {
    const llm = scriptedLlm(() => say("A smiling face"));
    const env = await startCore({ llm });
    const upkeep = createUpkeep({ store: env.core.store, llm, log: createLog("test", true) });
    try {
      env.core.store.settings.set("model_aux", model);
      const image = { media_id: "med_0000000000000001", mime: "image/png" };
      assert.equal(
        await upkeep.see("Describe the image", "Name this sticker", image, { purpose: "sticker" }),
        "A smiling face",
      );
      assert.deepEqual(llm.calls.at(-1)?.models, [model]);
      const message = llm.calls.at(-1)?.messages.at(-1);
      assert.ok(message?.role === "user");
      assert.deepEqual(message.images, [image]);
      assert.equal(llm.calls.length, 1);
    } finally {
      await upkeep.stop();
      await env.core.close();
      await env.cleanup();
    }
  });
}
