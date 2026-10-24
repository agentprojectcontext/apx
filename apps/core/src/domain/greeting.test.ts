import assert from "node:assert/strict";
import { test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";

test("after the setup the super-agent greets once, in the owner's language, and the model reads it as its own words", async () => {
  const llm = scriptedLlm(() => say("Nice to meet you"));
  const env = await startCore({ llm });
  try {
    const first = await env.client.call("setup.greet", { language: "es" });
    assert.deepEqual(first, { thread: "home", sent: true });
    const { messages } = await env.client.call("threads.get", { thread: "home" });
    const greeting = messages.at(-1);
    assert.deepEqual(greeting?.author, { kind: "agent", id: "roby" });
    assert.match(JSON.stringify(greeting?.parts[0]), /contame un poco de vos/);
    const choices = greeting?.parts.find((p) => p.type === "choices");
    assert.equal(choices?.type === "choices" && choices.options.length, 3);
    assert.equal(choices?.type === "choices" && choices.custom, true);

    // Once only.
    assert.deepEqual(await env.client.call("setup.greet", { language: "en" }), { thread: "home", sent: false });
    assert.equal((await env.client.call("threads.get", { thread: "home" })).messages.length, messages.length);

    // The owner's answer reaches the model after the greeting, as the agent's own (assistant) words.
    await env.client.call("threads.send", { thread: "home", text: "Soy Ada" });
    await env.settle("home");
    const sent = llm.calls.at(-1)?.messages ?? [];
    const said = sent.findIndex((m) => m.role === "assistant" && String(m.content).includes("Directo y breve"));
    assert.ok(said >= 0, "the greeting and its options are in the model's history");
    assert.ok(sent.slice(said + 1).some((m) => m.role === "user" && String(m.content).includes("Soy Ada")));
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("a chat already under way is not greeted", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  try {
    await env.client.call("threads.send", { thread: "home", text: "hello" });
    await env.settle("home");
    assert.deepEqual(await env.client.call("setup.greet", { language: "en" }), { thread: "home", sent: false });
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
