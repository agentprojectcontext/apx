import { test } from "node:test";
import assert from "node:assert/strict";
import { runAgent } from "#core/agent/run-agent.js";

test("super-agent fallback strips images when the next model is text-only", async () => {
  const events = [];
  const out = await runAgent({
    globalConfig: {
      super_agent: {
        enabled: true,
        model: "primary:fail-503",
        model_fallback: { enabled: true, models: ["text:ok"] },
      },
      engines: {
        primary: { engine: "mock" },
        text: { engine: "mock" },
      },
    },
    system: "test",
    prompt: "¿qué ves?",
    attachments: [{ mime: "image/png", data: "raw-base64", path: "/tmp/screenshot.png" }],
    toolSchemas: [],
    makeToolHandlers: () => ({}),
    toolHandlerCtx: {},
    onEvent: (event) => events.push(event),
  });

  assert.equal(out.model, "text:ok");
  assert.match(out.text, /\[imagen adjunta: \/tmp\/screenshot\.png\]/);
  assert.doesNotMatch(out.text, /raw-base64/);
  assert.ok(events.some((event) => event.type === "engine_failed" && event.retry_with === "text:ok"));
});
