// An agent asked "what model are you?" has nothing to read but its notebook —
// the model id lives in config, never in the weights. So it answered from a
// note written in June and told its owner it ran on gemini while it ran on Zen,
// then saved THAT as a verified fact. The loop now states the truth on every
// call, last in the system prompt, where it outranks the stale note.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRuntimeBlock } from "#core/agent/prompt-builder.js";
import { runAgent } from "#core/agent/run-agent.js";

test("buildRuntimeBlock names the model and tells the agent to distrust older claims", () => {
  const block = buildRuntimeBlock("zen:big-pickle");
  assert.match(block, /# Engine answering this turn/);
  assert.match(block, /`zen:big-pickle`/);
  assert.match(block, /stale/i, "a note that disagrees must be called stale, not weighed against this");
  assert.match(block, /[Nn]ever record the model/, "and it must not be written back into the notebook");
  // No model resolved yet → say nothing rather than guess.
  assert.equal(buildRuntimeBlock(null), "");
  assert.equal(buildRuntimeBlock(""), "");
});

test("run-agent hands the engine the model it is actually calling", async () => {
  const result = await runAgent({
    globalConfig: {
      super_agent: {
        enabled: true,
        model: "mock:test",
        permission_mode: "total",
        model_fallback: { enabled: false },
      },
      engines: {},
    },
    system: "# Notebook\nRoby runs on gemini-3.5-flash.",
    prompt: "[mock:system]",
    toolSchemas: [],
    makeToolHandlers: () => ({}),
    toolHandlerCtx: {},
  });

  assert.match(result.text, /# Engine answering this turn/, "every call carries the block");
  assert.match(result.text, /mock:test/, "and it names the model the loop resolved, not the configured string");
  assert.ok(
    result.text.indexOf("# Notebook") < result.text.indexOf("# Engine answering this turn"),
    "it goes AFTER the notebook — a correction that arrives first is not a correction",
  );
});
