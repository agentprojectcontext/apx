import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { callHandlers } from "../rpc/calls.ts";
import { manualTimers, waitFor } from "../testkit/platform.ts";
import { createCalls, type ToEngine } from "./calls.ts";
import { callTool, say, scriptedLlm, startCore } from "./testkit.ts";

let scout = "";
const llm = scriptedLlm((_req, { system, said, afterTool }) =>
  system.startsWith("You are Scout")
    ? say("Agent UI es una interfaz para trabajar con agentes.")
    : said.includes("<delegation_result")
      ? say("Scout encontró que Agent UI es una interfaz para trabajar con agentes.")
      : said.includes("Pedido por voz") && said.includes("anotá") && afterTool
        ? say("Listo, lo anoté.")
        : said.includes("Pedido por voz") && said.includes("anotá")
          ? callTool("n1", "task_create", { title: "Llamar al dentista" })
          : said.includes("Pedido por voz") && said.includes("Scout") && afterTool
            ? say("Le encargué a Scout la búsqueda; te cuento cuando termine.")
            : said.includes("Pedido por voz") && said.includes("Scout")
              ? callTool("t1", "task_create", {
                  title: "Buscar qué es Agent UI",
                  assignee: scout,
                  goal: "Saber qué es Agent UI",
                  description: "- Buscá qué es Agent UI.",
                })
              : said.includes("Pedido por voz")
                ? say("Tenés dos tareas vencidas. La más vieja es de septiembre.")
                : said.includes("(Note.")
                  ? say("Dale, dejame que lo veo. [[task: listar las tareas vencidas]]")
                  : say("ok"),
);

let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  env = await startCore({ llm });
  scout = "scout"; // one of the agents every install starts with
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

test("the chat follows the call live: the owner's words as they speak, joined until the voice answers, and its words as they play", () => {
  const calls = callsAt({ t: 0 });
  const { thread_id, ticket } = calls.start({ voice: "female", locale: "es-AR" });
  calls.redeem(ticket);
  const texts = () =>
    env.core.store.messages
      .list(thread_id)
      .map((m) => [m.author.kind, m.parts.map((p) => (p.type === "text" ? p.text : p.type)).join("|")]);

  calls.hear(thread_id, { type: "partial", text: "Quiero que" });
  assert.deepEqual(texts(), [["user", "Quiero que"]], "shown while it is being said");
  calls.hear(thread_id, { type: "partial", text: "Quiero que revises" });
  calls.hear(thread_id, { type: "heard", text: "Quiero que revises las rutinas." });
  calls.hear(thread_id, { type: "partial", text: "" });
  calls.hear(thread_id, { type: "partial", text: "y los flujos" });
  assert.deepEqual(texts(), [["user", "Quiero que revises las rutinas. y los flujos"]], "a pause keeps one message");
  calls.hear(thread_id, { type: "partial", text: "" });
  assert.deepEqual(texts(), [["user", "Quiero que revises las rutinas."]], "noise or echo is taken back");
  calls.hear(thread_id, { type: "heard", text: "Y los flujos." });

  calls.hear(thread_id, { type: "saying", text: "Dale," });
  calls.hear(thread_id, { type: "saying", text: "Dale, ya" });
  assert.deepEqual(texts().at(-1), ["agent", "Dale, ya"], "the voice's words show as they play");
  calls.hear(thread_id, { type: "said", text: "Dale, ya lo veo." });
  calls.hear(thread_id, { type: "saying", text: "Un momento." });
  calls.hear(thread_id, { type: "said", text: "Un momento." });
  calls.hear(thread_id, { type: "turn_end" });
  calls.hear(thread_id, { type: "partial", text: "Gracias" });
  assert.deepEqual(texts(), [
    ["user", "Quiero que revises las rutinas. Y los flujos."],
    ["agent", "Dale, ya lo veo. Un momento."],
    ["user", "Gracias"],
  ]);
  calls.end(thread_id);
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

test("an ask the agent hands to a teammate is told as handed on, and its result is told when the report comes back", async () => {
  const calls = callsAt({ t: 0 });
  const { thread_id, ticket } = calls.start({ voice: "female", locale: "es-AR" });
  calls.redeem(ticket);
  const told: ToEngine[] = [];
  calls.attach(
    thread_id,
    (f) => told.push(f),
    () => {},
  );
  calls.hear(thread_id, {
    type: "ask",
    n: 1,
    task: "pedile a Scout que busque Agent UI",
    heard: "que Scout busque Agent UI",
  });
  const sub = env.core.store.threads.children(thread_id)[0] ?? "";
  await waitFor(async () => told.length > 0, "what the agent says on handing it on");
  assert.deepEqual(told[0], {
    type: "result",
    n: 1,
    state: "working",
    text: "Le encargué a Scout la búsqueda; te cuento cuando termine.",
  });
  const card = () =>
    env.core.store.messages
      .list(thread_id)
      .flatMap((m) => m.parts)
      .find((p) => p.type === "subthread");
  assert.equal(card()?.type === "subthread" && card()?.state, "working", "the card keeps working while Scout does");

  // Scout's report comes back to the ask's chat, as a closed task's does.
  env.core.engine.admit({
    thread_id: sub,
    agent_id: "superagent",
    trigger: "a2a_result",
    origin: {
      kind: "agent",
      id: scout,
      name: "Scout",
      thread_id: sub,
      run_id: env.core.store.runs.latestId(sub) ?? "",
    },
    text: "<delegation_result>Agent UI es una interfaz para trabajar con agentes.</delegation_result>",
  });
  await waitFor(async () => told.length > 1, "the result once the report is in");
  assert.deepEqual(told[1], {
    type: "result",
    n: 1,
    state: "done",
    text: "Scout encontró que Agent UI es una interfaz para trabajar con agentes.",
    by: "Scout",
  });
  assert.equal(card()?.type === "subthread" && card()?.state, "completed");
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

test("what the owner types in the call's chat during the call is theirs, and goes to the voice to answer aloud", () => {
  const calls = callsAt({ t: 0 });
  const { thread_id, ticket } = calls.start({ voice: "female", locale: "es-AR" });
  assert.equal(calls.typed(thread_id, "hola"), false, "not before the call is on");
  calls.redeem(ticket);
  const told: ToEngine[] = [];
  calls.attach(
    thread_id,
    (f) => told.push(f),
    () => {},
  );
  assert.equal(calls.typed(thread_id, "Buscá las novedades de NVIDIA"), true);
  assert.deepEqual(told, [{ type: "typed", text: "Buscá las novedades de NVIDIA" }]);
  const last = env.core.store.messages.list(thread_id).at(-1);
  assert.equal(last?.author.kind, "user");
  assert.deepEqual(last?.parts, [{ type: "text", text: "Buscá las novedades de NVIDIA" }]);
  calls.end(thread_id);
  assert.equal(calls.typed(thread_id, "otra"), false, "after it ends, typing is a chat again");
});

test("a task only noted down settles the ask: nothing is coming back", async () => {
  const calls = callsAt({ t: 0 });
  const { thread_id, ticket } = calls.start({ voice: "female", locale: "es-AR" });
  calls.redeem(ticket);
  const told: ToEngine[] = [];
  calls.attach(
    thread_id,
    (f) => told.push(f),
    () => {},
  );
  calls.hear(thread_id, { type: "ask", n: 1, task: "anotá llamar al dentista", heard: "anotá llamar al dentista" });
  await waitFor(async () => told.length > 0, "the answer");
  assert.deepEqual(told[0], { type: "result", n: 1, state: "done", text: "Listo, lo anoté." });
  const card = env.core.store.messages
    .list(thread_id)
    .flatMap((m) => m.parts)
    .find((p) => p.type === "subthread");
  assert.equal(card?.type === "subthread" && card.state, "completed");
  calls.end(thread_id);
});

test("calls from the panel say plainly what this machine still needs", async () => {
  const handlers = callHandlers(undefined);
  assert.deepEqual(handlers["calls.status"](), { ready: false, running: false, missing: "platform" });
  assert.throws(() => handlers["calls.start"]({}), /calls need a Mac with Apple silicon/);
});

test("a quick request said by name is a short back-and-forth the core ends: the owner's goodbye, silence or confusion", async () => {
  const timers = manualTimers();
  const calls = createCalls({
    store: env.core.store,
    bus: env.core.bus,
    admit: env.core.engine.admit,
    log: quiet,
    llm,
    models: () => ["fake/fake-1"],
    timers,
  });
  const open = (locale: "es-AR" | "en-US" = "es-AR") => {
    const { thread_id, ticket } = calls.start({ voice: "female", locale, mode: "quick", device: "phone-1" });
    const setup = calls.redeem(ticket).setup;
    const told: ToEngine[] = [];
    let hungUp = 0;
    calls.attach(
      thread_id,
      (f) => told.push(f),
      () => {
        hungUp++;
        calls.end(thread_id);
      },
    );
    calls.hear(thread_id, { type: "ready" });
    const turn = (heard: string, said: string) => {
      calls.hear(thread_id, { type: "partial", text: heard.slice(0, 5) });
      calls.hear(thread_id, { type: "heard", text: heard });
      calls.hear(thread_id, { type: "saying", text: said });
      timers.tick(3_000);
      calls.hear(thread_id, { type: "said", text: said });
      calls.hear(thread_id, { type: "turn_end" });
    };
    const ends = () => told.filter((f) => f.type === "end");
    return { thread_id, setup, told, turn, ends, hungUp: () => hungUp };
  };

  const bye = open();
  assert.match(bye.setup.confused, /No te entendí/);
  bye.turn("Roby, ¿cómo están los platos?", "El lavavajillas terminó hace una hora.");
  timers.tick(8_000);
  bye.turn("Ok, entonces prendelo", "Dale, lo prendo.");
  timers.tick(8_000);
  bye.turn("¿Cuánto tarda?", "Una hora y media.");
  assert.deepEqual(bye.ends(), [], "three turns and it is still on");
  calls.hear(bye.thread_id, { type: "heard", text: "Listo, gracias" });
  assert.deepEqual(bye.ends(), [{ type: "end", reason: "goodbye", text: "Dale, chau." }]);
  calls.hear(bye.thread_id, { type: "think", id: 9, messages: [] });
  assert.ok(!bye.told.some((f) => f.type === "thought"), "a request that is ending asks its model nothing more");
  timers.tick(10_000);
  assert.equal(bye.hungUp(), 1, "an engine that does not hang up is hung up by the core");
  const said = env.core.store.messages.list(bye.thread_id).filter((m) => m.author.kind === "user");
  assert.equal(said.length, 4, "every turn is written in the call");
  assert.deepEqual(env.core.store.threads.get(bye.thread_id)?.call, { mode: "quick", device: "phone-1" });

  const quiet9 = open("en-US");
  quiet9.turn("What time is it in Tokyo?", "It's ten at night there.");
  timers.tick(8_999);
  assert.deepEqual(quiet9.ends(), []);
  timers.tick(1);
  assert.deepEqual(quiet9.ends(), [{ type: "end", reason: "idle", text: "" }]);
  calls.end(quiet9.thread_id);

  const lost = open();
  lost.turn("mmm la cosa esa", "No te entendí, ¿me repetís?");
  lost.turn("eso que te dije", "Perdón, no te entendí.");
  assert.deepEqual(lost.ends(), [
    { type: "end", reason: "confused", text: "No te entendí; cualquier cosa me volvés a llamar." },
  ]);
  calls.end(lost.thread_id);
});
