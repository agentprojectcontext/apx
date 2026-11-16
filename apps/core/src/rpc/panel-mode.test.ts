import assert from "node:assert/strict";
import { test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { waitFor } from "../testkit/platform.ts";

test("the panel's mode starts advanced, switches for every panel, and is told live once", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  const socket = await env.client.connect();
  try {
    assert.deepEqual(await env.client.call("panel.mode", {}), { mode: "advanced" });
    const told: unknown[] = [];
    socket.onEvent((e) => {
      if (e.type === "panel.mode") told.push((e.payload as { mode?: unknown }).mode);
    });
    await env.client.call("panel.set_mode", { mode: "simple" });
    assert.deepEqual(await env.client.call("panel.mode", {}), { mode: "simple" });
    await waitFor(async () => told.length > 0 || undefined, "the panel.mode event");
    await env.client.call("panel.set_mode", { mode: "simple" });
    await env.client.call("panel.set_mode", { mode: "advanced" });
    await waitFor(async () => told.length > 1 || undefined, "the second panel.mode event");
    assert.deepEqual(told, ["simple", "advanced"], "the same mode again tells nobody");
  } finally {
    socket.close();
    await socket.closed;
    await env.core.close();
    await env.cleanup();
  }
});
