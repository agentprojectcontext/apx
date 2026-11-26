import assert from "node:assert/strict";
import { test } from "node:test";
import type { Part } from "@apx/protocol";
import { HOME_THREAD_ID } from "../domain/seed.ts";
import { callTool, say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { waitFor } from "../testkit/platform.ts";

const RESEARCH_LINE = /Research is on: .*apx_settings discovery\.add/;
const notices = (parts: Part[], code: string) =>
  parts.filter((p): p is Extract<Part, { type: "notice" }> => p.type === "notice" && p.code === code);

test("the super-agent adds an interest from the chat on its own, and the chat shows a research chip", async () => {
  const llm = scriptedLlm((_req, { said, afterTool }) => {
    if (afterTool) return say("¡Qué lindo! Contame qué cámara usás.");
    if (said.includes("fotografía analógica"))
      return callTool("add", "apx_settings", {
        method: "discovery.add",
        params: { interests: ["Fotografía analógica"], location: "Córdoba" },
      });
    return say("ok");
  });
  const env = await startCore({ llm });
  try {
    const off = await env.client.call("threads.create", { kind: "loose", agent_id: "superagent" });
    await env.client.call("threads.send", { thread: off.id, text: "hola" });
    await env.settle(off.id);
    const offPrompt = String(llm.calls.at(-1)?.messages[0]?.content ?? "");
    assert.doesNotMatch(offPrompt, RESEARCH_LINE, "research off: nothing about it in the prompt");

    await env.client.call("discovery.configure", { enabled: true });
    const t = await env.client.call("threads.create", { kind: "loose", agent_id: "superagent" });
    await env.client.call("threads.send", { thread: t.id, text: "Últimamente me copa la fotografía analógica" });
    const { messages } = await env.settle(t.id);
    const prompt = String(
      llm.calls.find((c) => String(c.messages.at(-1)?.content).includes("analógica"))?.messages[0]?.content,
    );
    assert.match(prompt, RESEARCH_LINE, "research on: the prompt says how to add to it");

    const settings = (await env.client.call("discovery.settings", {})).settings;
    assert.deepEqual(settings.interests, ["Fotografía analógica"]);
    assert.equal(settings.location, "Córdoba");
    const answer = messages.findLast((m) => m.author.kind === "agent");
    assert.ok(answer);
    const [chip] = notices(answer.parts, "research.updated");
    assert.equal(chip?.vars?.interests, "Fotografía analógica");
    assert.equal(chip?.vars?.location, "Córdoba");
    const step = answer.parts.find((p) => p.type === "tool" && p.tool === "apx_settings");
    assert.ok(step?.type === "tool" && step.status === "ok", "it ran without a card");
    assert.equal(chip?.vars?.call, step.call_id, "the chip names its step, which the chat folds into it");
    assert.ok(!answer.parts.some((p) => p.type === "input"), "no approval card");
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("adding to research is not offered while it is off, and takes only the owner's own words", async () => {
  const llm = scriptedLlm((req, { said, afterTool }) => {
    if (afterTool) return say(String(req.messages.at(-1)?.content));
    if (said.includes("index")) return callTool("index", "apx_settings", { method: "discovery" });
    if (said.includes("add"))
      return callTool("add", "apx_settings", { method: "discovery.add", params: { interests: ["Jazz"] } });
    return say("ok");
  });
  const env = await startCore({ llm });
  try {
    const ask = async (text: string) => {
      const t = await env.client.call("threads.create", { kind: "loose", agent_id: "superagent" });
      await env.client.call("threads.send", { thread: t.id, text });
      const { messages } = await env.settle(t.id);
      return messages.findLast((m) => m.author.kind === "agent")?.parts.find((p) => p.type === "text")?.text ?? "";
    };
    assert.doesNotMatch(await ask("index"), /discovery\.add/);
    assert.match(await ask("add"), /no method "discovery\.add"/);
    assert.deepEqual((await env.client.call("discovery.settings", {})).settings.interests, []);

    await env.client.call("discovery.configure", { enabled: true });
    assert.match(await ask("index"), /discovery\.add/);
    // A routine's run is not the owner talking: nothing is added.
    const routine = await env.client.call("routines.set", {
      name: "Jazz",
      agent: "superagent",
      schedule: { kind: "every", minutes: 60 },
      prompt: "add",
    });
    await env.client.call("routines.run", { routine: routine.id });
    await waitFor(async () => (await env.client.call("routines.list", {})).routines.some((r) => r.last), "the run");
    assert.deepEqual((await env.client.call("discovery.settings", {})).settings.interests, []);
    assert.match(await ask("add"), /added/);
    assert.deepEqual((await env.client.call("discovery.settings", {})).settings.interests, ["Jazz"]);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("the owner's panel may add to research, and an interest it has is not added twice", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  try {
    await env.client.call("discovery.configure", { enabled: true });
    const added = await env.client.call("discovery.add", { interests: ["Ajedrez"] });
    assert.deepEqual(added.interests, ["Ajedrez"], "the owner's panel may add");
    const again = await env.client.call("discovery.add", { interests: ["ajedrez"] });
    assert.deepEqual(again.interests, [], "an interest it has is not added twice");
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("turning research on posts the super-agent's offer in the home chat", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  try {
    const said = async () =>
      (await env.client.call("threads.get", { thread: HOME_THREAD_ID })).messages.filter(
        (m) => m.author.kind === "agent",
      ).length;
    const before = await said();
    await env.client.call("discovery.configure", { enabled: true });
    await waitFor(async () => (await said()) > before, "the offer in the home chat");
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
