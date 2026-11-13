import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { waitFor } from "../testkit/platform.ts";
import { createCalls, type ToEngine } from "./calls.ts";
import { say, scriptedLlm, startCore } from "./testkit.ts";

const llm = scriptedLlm((_req, { said }) =>
  said.includes("Pedido por voz")
    ? say("Tenés dos tareas vencidas. La más vieja es de septiembre.")
    : said.includes("(Note.")
      ? say("Dale, dejame que lo veo. [[task: listar las tareas vencidas]]")
      : say("ok"),
);

let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  env = await startCore({ llm });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

const quiet = { info() {}, warn() {}, error() {} };
const callsAt = (clock: { t: number }, models = ["fake/fake-1"]) =>
  createCalls({
    store: env.core.store,
    bus: env.core.bus,
    admit: env.core.engine.admit,
    log: quiet,
    llm,
    models: () => models,
    now: () => clock.t,
  });

test("a call opens a thread of its own with the super-agent, and its ticket lets one socket in, once and in time", () => {
  const clock = { t: 1_000 };
  const calls = callsAt(clock);
  const { thread_id, ticket, expires_in } = calls.start({ voice: "male", locale: "es-AR" });
  const thread = env.core.store.threads.get(thread_id);
  assert.equal(thread?.kind, "call");
  assert.equal(env.core.store.agents.get(thread?.agent_ids[0] ?? "")?.kind, "secretary");
  assert.equal(expires_in, 60);

  const call = calls.redeem(ticket);
  assert.equal(call.thread, thread_id);
  assert.equal(call.setup.voice, "male");
  assert.equal(call.setup.locale, "es-AR");
  assert.match(call.setup.who, /personal assistant/);
  assert.throws(() => calls.start({ voice: "female", locale: "es" }), /already going on/);
  calls.end(thread_id);
  assert.throws(() => calls.redeem(ticket), /expired/, "a ticket is used once");

  const late = calls.start({ voice: "female", locale: "es" });
  clock.t += 61_000;
  assert.throws(() => calls.redeem(late.ticket), /expired/);
  assert.equal(
    calls.start({ voice: "female", locale: "es", thread: thread_id }).thread_id,
    thread_id,
    "calling again goes on there",
  );
});

test("what the owner says and what the voice answers are written in the call, one message per turn", () => {
  const calls = callsAt({ t: 0 });
  const { thread_id, ticket } = calls.start({ voice: "female", locale: "es-AR" });
  calls.redeem(ticket);
  calls.hear(thread_id, { type: "heard", text: "Hola, ¿cómo andás?" });
  calls.hear(thread_id, { type: "said", text: "Bien, ¿y vos?" });
  calls.hear(thread_id, { type: "said", text: "Contame." });
  calls.hear(thread_id, { type: "turn_end" });
  calls.hear(thread_id, { type: "said", text: "Otra cosa." });
  calls.end(thread_id);
  calls.hear(thread_id, { type: "heard", text: "after the call" });

  const msgs = env.core.store.messages.list(thread_id);
  const texts = msgs.map((m) => [m.author.kind, m.parts.map((p) => (p.type === "text" ? p.text : p.type)).join("|")]);
  assert.deepEqual(texts, [
    ["user", "Hola, ¿cómo andás?"],
    ["agent", "Bien, ¿y vos? Contame."],
    ["agent", "Otra cosa."],
  ]);
  assert.equal(env.core.store.threads.get(thread_id)?.preview, "Otra cosa.");
});

test("what the voice asks runs as the super-agent in a chat under the call, shown as a card that settles with the answer", async () => {
  const calls = callsAt({ t: 0 });
  const { thread_id, ticket } = calls.start({ voice: "female", locale: "es-AR" });
  calls.redeem(ticket);
  const told: ToEngine[] = [];
  calls.attach(
    thread_id,
    (f) => told.push(f),
    () => {},
  );
  calls.hear(thread_id, { type: "heard", text: "¿Qué tengo vencido?" });
  calls.hear(thread_id, { type: "said", text: "Dale, dejame que lo veo." });
  calls.hear(thread_id, { type: "ask", n: 1, task: "listar las tareas vencidas", heard: "¿Qué tengo vencido?" });

  const sub = env.core.store.threads.get(env.core.store.threads.children(thread_id)[0] ?? "");
  assert.equal(sub?.kind, "agent");
  assert.equal(sub?.agent_ids[0], env.core.store.threads.get(thread_id)?.agent_ids[0]);
  const card = () =>
    env.core.store.messages
      .list(thread_id)
      .flatMap((m) => m.parts)
      .find((p) => p.type === "subthread");
  assert.equal(card()?.type === "subthread" && card()?.state, "working");

  await waitFor(async () => told.length > 0, "the answer goes back to the voice");
  assert.deepEqual(told[0], {
    type: "result",
    n: 1,
    state: "done",
    text: "Tenés dos tareas vencidas. La más vieja es de septiembre.",
  });
  const settled = card();
  assert.equal(settled?.type === "subthread" && settled.state, "completed");
  assert.equal(
    settled?.type === "subthread" && settled.summary,
    "Tenés dos tareas vencidas. La más vieja es de septiembre.",
  );
  const asked = llm.calls.find((c) => String(c.messages.at(-1)?.content).includes("Pedido por voz"));
  assert.match(String(asked?.messages.at(-1)?.content), /«¿Qué tengo vencido\?»/, "the owner's own words go along");
  calls.end(thread_id);
});

test("any agent can be called: the call and what it asks are that agent's, worked with its own model", async () => {
  const store = env.core.store;
  const created = await env.client.call("agents.create", { slug: "nora", name: "Nora", role: "Finance" });
  const agent = { id: created.id };
  await env.client.call(
    "agents.update",
    { agent: agent.id, model_choice: { model: "fake/nora-1", router: false } },
    "k-nora",
  );
  const calls = callsAt({ t: 0 });
  const { thread_id, ticket } = calls.start({ agent_id: agent.id, voice: "female", locale: "en-US" });
  assert.deepEqual(store.threads.get(thread_id)?.agent_ids, [agent.id]);
  const call = calls.redeem(ticket);
  assert.equal(call.setup.agent, "Nora");
  assert.match(call.setup.who, /agents in APX \(Finance\)/);
  const told: ToEngine[] = [];
  calls.attach(
    thread_id,
    (f) => told.push(f),
    () => {},
  );
  calls.hear(thread_id, { type: "ask", n: 1, task: "check the invoices", heard: "check the invoices" });
  calls.hear(thread_id, { type: "ask", n: 2, task: "list overdue payments", heard: "and overdue payments" });
  const subs = store.threads.children(thread_id).map((id) => store.threads.get(id));
  assert.equal(subs.length, 2, "two asks at once, each in its own chat under the call");
  for (const sub of subs) assert.deepEqual(sub?.agent_ids, [agent.id]);
  await waitFor(async () => told.length === 2, "both answers come back");
  const asked = llm.calls.filter((c) => String(c.messages.at(-1)?.content).includes("Asked by voice"));
  assert.ok(
    asked.every((c) => c.models[0] === "fake/nora-1"),
    "the agent works with its own model",
  );
  calls.end(thread_id);
  assert.throws(() => calls.start({ agent_id: "nobody", voice: "female", locale: "es" }), /not found|agent nobody/);
});

test("what the call says comes from the call's model, streamed to the voice and counted as a call", async () => {
  const calls = callsAt({ t: 0 }, ["fake/voice-1"]);
  const { thread_id, ticket } = calls.start({ voice: "female", locale: "es-AR" });
  calls.redeem(ticket);
  const told: ToEngine[] = [];
  calls.attach(
    thread_id,
    (f) => told.push(f),
    () => {},
  );
  const messages = [
    { role: "system", content: "You are Roby." },
    { role: "user", content: "¿Qué tengo vencido?\n(Note. Call language: Spanish.)" },
    { role: "tool", content: "never sent" },
  ];
  calls.hear(thread_id, { type: "think", id: 7, messages });
  await waitFor(async () => told.some((f) => f.type === "thought_end"), "the reply ends");
  assert.equal(
    told
      .filter((f) => f.type === "thought")
      .map((f) => (f.type === "thought" ? f.text : ""))
      .join(""),
    "Dale, dejame que lo veo. [[task: listar las tareas vencidas]]",
  );
  assert.deepEqual(told.at(-1), { type: "thought_end", id: 7 });
  const sent = llm.calls.at(-1);
  assert.deepEqual(sent?.models, ["fake/voice-1"]);
  assert.deepEqual(sent?.tools, [], "the voice has no tools: work goes to the agent");
  assert.ok(!sent?.messages.some((m) => m.role === "tool"), "only plain text goes to the model");
  calls.end(thread_id);

  const none = callsAt({ t: 0 }, []);
  const again = none.start({ voice: "female", locale: "es" });
  none.redeem(again.ticket);
  const said: ToEngine[] = [];
  none.attach(
    again.thread_id,
    (f) => said.push(f),
    () => {},
  );
  none.hear(again.thread_id, { type: "think", id: 1, messages });
  await waitFor(async () => said.length > 0, "a call with no model says so");
  assert.deepEqual(said[0], { type: "thought_end", id: 1, error: "the model did not answer" });
  assert.equal(none.hasModel(), false);
  none.end(again.thread_id);
});

test("calls from the panel say plainly what this machine still needs", async () => {
  const status = await env.client.call("calls.status", {});
  if (status.ready) return; // a Mac that runs the voice, with a model: nothing is missing
  assert.ok(status.missing);
  await assert.rejects(env.client.call("calls.start", { voice: "female" }, "k-1"), /calls need|turned off|memory/);
});
