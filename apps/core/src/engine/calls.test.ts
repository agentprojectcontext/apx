import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { waitFor } from "../testkit/platform.ts";
import { createCalls, type ToEngine } from "./calls.ts";
import { say, scriptedLlm, startCore } from "./testkit.ts";

const llm = scriptedLlm((_req, { said }) =>
  said.includes("Pedido por voz") ? say("Tenés dos tareas vencidas. La más vieja es de septiembre.") : say("ok"),
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
const callsAt = (clock: { t: number }) =>
  createCalls({
    store: env.core.store,
    bus: env.core.bus,
    admit: env.core.engine.admit,
    log: quiet,
    now: () => clock.t,
  });

test("a call opens a thread of its own with the super-agent, and its ticket lets one socket in, once and in time", () => {
  const clock = { t: 1_000 };
  const calls = callsAt(clock);
  const { thread_id, ticket, expires_in } = calls.start({ voice: "male", lang: "es" });
  const thread = env.core.store.threads.get(thread_id);
  assert.equal(thread?.kind, "call");
  assert.equal(env.core.store.agents.get(thread?.agent_ids[0] ?? "")?.kind, "secretary");
  assert.equal(expires_in, 60);

  const call = calls.redeem(ticket);
  assert.equal(call.thread, thread_id);
  assert.equal(call.voice, "male");
  assert.throws(() => calls.start({ voice: "female" }), /already going on/);
  calls.end(thread_id);
  assert.throws(() => calls.redeem(ticket), /expired/, "a ticket is used once");

  const late = calls.start({ voice: "female" });
  clock.t += 61_000;
  assert.throws(() => calls.redeem(late.ticket), /expired/);
  assert.equal(calls.start({ voice: "female", thread: thread_id }).thread_id, thread_id, "calling again goes on there");
});

test("what the owner says and what the voice answers are written in the call, one message per turn", () => {
  const calls = callsAt({ t: 0 });
  const { thread_id, ticket } = calls.start({ voice: "female", lang: "es" });
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
  const { thread_id, ticket } = calls.start({ voice: "female", lang: "es" });
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

test("calls from the panel say plainly what this machine still needs", async () => {
  const status = await env.client.call("calls.status", {});
  assert.equal(status.ready, false);
  assert.ok(status.missing);
  await assert.rejects(env.client.call("calls.start", { voice: "female" }, "k-1"), /calls need/);
});
