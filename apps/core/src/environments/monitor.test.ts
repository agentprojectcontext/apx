import assert from "node:assert/strict";
import { test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { createVmLifecycle } from "./lifecycle.ts";

const numbers = {
  running: true,
  name: "computer",
  cpus: 2,
  memory_assigned_mb: 4096,
  memory_used_mb: 1500,
  disk_mb: 3072,
};

test("system.usage carries the shared computer's numbers once the owner set it up, and no VM slot before", async () => {
  const lifecycle = createVmLifecycle({
    supported: true,
    installed: () => true,
    running: async () => true,
    prepare: async () => {},
    stop: async () => {},
    appearance: async () => {},
  });
  const env = await startCore({
    llm: scriptedLlm(() => say("ok")),
    computer: { limaHome: "/unused", instance: "missing", lifecycle, usage: async () => numbers },
  });
  try {
    assert.equal((await env.client.call("system.usage", {})).vm, undefined, "a computer nobody set up has no slot");
    await env.client.call("environments.permit", { agent: "roby", on: true });
    await env.client.call("environments.enable", { thread: "home", appearance: "light" });
    assert.deepEqual((await env.client.call("system.usage", {})).vm, numbers);
  } finally {
    await env.core.close();
    env.cleanup();
  }
});

test("system.usage has no VM slot on a core with no computer configured", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  try {
    assert.equal((await env.client.call("system.usage", {})).vm, undefined);
  } finally {
    await env.core.close();
    env.cleanup();
  }
});
