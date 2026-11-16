import assert from "node:assert/strict";
import { test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";

test("after the setup the super-agent greets once and gets to know the owner, one question at a time", async () => {
  const llm = scriptedLlm(() => say("¡Genial, Ada!"));
  const env = await startCore({ llm });
  const last = async () => (await env.client.call("threads.get", { thread: "home" })).messages.at(-1);
  const choicesOf = async () => (await last())?.parts.find((p) => p.type === "choices");
  try {
    const first = await env.client.call("setup.greet", { language: "es" });
    assert.deepEqual(first, { thread: "home", sent: true });
    const greeting = await last();
    assert.deepEqual(greeting?.author, { kind: "agent", id: "superagent" });
    assert.match(JSON.stringify(greeting?.parts[0]), /¿Cómo te llamo\?/);
    const name = await choicesOf();
    assert.ok(name?.type === "choices" && name.for === "name" && name.options.length === 0 && name.custom);

    // Once only.
    assert.deepEqual(await env.client.call("setup.greet", { language: "en" }), { thread: "home", sent: false });

    // Each answer is kept, shown as the owner's words, and the next question follows without a model call.
    assert.deepEqual(await env.client.call("setup.onboard", { step: "name", answer: "Ada" }), { next: "work" });
    assert.equal((await env.client.call("owner.get", {})).name, "Ada");
    const work = await choicesOf();
    assert.ok(work?.type === "choices" && work.for === "work" && work.options.length > 0);
    assert.match(JSON.stringify((await last())?.parts[0]), /Ada/);
    await env.client.call("setup.onboard", { step: "work", answer: "Tengo mi negocio" });
    await env.client.call("setup.onboard", { step: "personality", answer: "Directo y breve" });
    const done = await env.client.call("setup.onboard", { step: "help", answer: "Ordenar mi mail" });
    assert.deepEqual(done, { say: "Primero ayudame con: Ordenar mi mail." });
    assert.match(
      (await env.client.call("owner.get", {})).about ?? "",
      /Work: Tengo mi negocio[\s\S]*help first with: Ordenar mi mail/,
    );
    assert.equal(llm.calls.length, 0, "no model call until the last answer is sent");

    // The last answer goes as the owner's message: the model reads every question and answer before it.
    await env.client.call("threads.send", { thread: "home", text: done.say ?? "" });
    await env.settle("home");
    const sent = llm.calls.at(-1)?.messages ?? [];
    const text = sent.map((m) => String(m.content)).join("\n");
    assert.match(text, /¿Cómo te llamo\?[\s\S]*Decime Ada[\s\S]*finished getting to know you[\s\S]*Ordenar mi mail/);
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
