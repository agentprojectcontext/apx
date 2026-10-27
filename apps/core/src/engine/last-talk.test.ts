import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createBus } from "../bus.ts";
import { openDb } from "../db/db.ts";
import { seed } from "../domain/seed.ts";
import { createStore, type Store } from "../domain/store.ts";
import { tempDir, waitFor } from "../testkit/platform.ts";
import { lastTalk, unasked } from "./last-talk.ts";
import { say, scriptedLlm, startCore } from "./testkit.ts";

const HOUR = 3600_000;
const GREET = /open with one short greeting/;
const GO_ON = /mid-conversation: go on as in a chat, with no greeting/;

async function withStore(work: (store: Store) => void) {
  const dir = tempDir("apx-last-talk-");
  const db = openDb(dir.path);
  try {
    const store = createStore(db, createBus());
    seed(store, "Roby");
    work(store);
  } finally {
    db.close();
    await dir.remove();
  }
}

const at = new Date("2026-10-27T15:00:00Z");
const earlier = (ms: number) => new Date(at.getTime() - ms).toISOString();
const ownerSaid = (store: Store, text: string, ago: number, thread = "home") =>
  store.messages.add({
    thread_id: thread,
    author: { kind: "user" },
    parts: [{ type: "text", text }],
    at: earlier(ago),
  });
const agentSaid = (store: Store, ago: number, run_id?: string) =>
  store.messages.add({
    thread_id: "home",
    author: { kind: "agent", id: "roby" },
    parts: [{ type: "text", text: "Listo." }],
    at: earlier(ago),
    ...(run_id ? { run_id } : {}),
  });
const home = { id: "home", kind: "home" as const };

test("a message soon after they talked goes on with the conversation; after hours of silence it greets", () =>
  withStore((store) => {
    assert.match(lastTalk(store, home, at) ?? "", /not talked yet: open with a short greeting/);
    ownerSaid(store, "¿Y el informe?", 20 * 60_000);
    const soon = lastTalk(store, home, at) ?? "";
    assert.match(soon, /The owner last wrote 20 min ago\./, "its own chat's words are in its history: no excerpt");
    assert.match(soon, GO_ON);
    assert.doesNotMatch(soon, GREET);
    assert.match(lastTalk(store, home, new Date(at.getTime() + 7 * HOUR)) ?? "", GREET);
  }));

test("a message APX sent them counts as talking; the turn's own message does not", () =>
  withStore((store) => {
    ownerSaid(store, "hola", 10 * HOUR);
    agentSaid(store, 0, "run_now");
    assert.match(lastTalk(store, home, at, undefined, "run_now") ?? "", GREET, "the turn's own empty message");
    store.nudges.add({ kind: "routine:Watch", text: "News.", state: "sent", exempt: true, at: earlier(HOUR) });
    const told = lastTalk(store, home, at, undefined, "run_now") ?? "";
    assert.match(told, /The last message to them went 1 h ago\./);
    assert.match(told, GO_ON);
    store.nudges.add({ kind: "routine:Other", text: "Held.", state: "dropped", exempt: false, at: earlier(60_000) });
    assert.match(lastTalk(store, home, at, undefined, "run_now") ?? "", /went 1 h ago/, "only what reached them");
  }));

test("a new day after a few hours greets; the same day does not", () =>
  withStore((store) => {
    // 04:00 after 23:00 the day before, in the owner's zone.
    const morning = new Date("2026-10-27T04:00:00Z");
    store.messages.add({
      thread_id: "home",
      author: { kind: "user" },
      parts: [{ type: "text", text: "chau" }],
      at: "2026-10-26T23:00:00Z",
    });
    assert.match(lastTalk(store, home, morning, "UTC") ?? "", GREET);
    assert.match(lastTalk(store, home, new Date("2026-10-26T23:50:00Z"), "UTC") ?? "", GO_ON);
  }));

test("a routine's chat reads Home, with the owner's last words; another agent's chat gets nothing", () =>
  withStore((store) => {
    ownerSaid(store, "Avisame cuando llegue lo de Northwind", 30 * 60_000);
    const routine = store.threads.create({ kind: "routine", agent_ids: ["roby"], title: "Watch" });
    // Its prompt is stored as the owner's words, but it is not the owner talking.
    store.messages.add({ thread_id: routine.id, author: { kind: "user" }, parts: [{ type: "text", text: "check" }] });
    const text = lastTalk(store, routine, at) ?? "";
    assert.match(text, /The owner last wrote 30 min ago: "Avisame cuando llegue lo de Northwind"\./);
    assert.equal(lastTalk(store, { id: "x", kind: "a2a" }, at), undefined);
  }));

test("only turns the owner did not just start are unasked", () => {
  assert.equal(unasked({ kind: "routine", id: "r", name: "Watch" }), true);
  assert.equal(
    unasked({ kind: "task_result", task_id: "t", title: "T", state: "done", agent_id: "a", name: "Cody" }),
    true,
  );
  assert.equal(unasked({ kind: "stalled_task", task_id: "t", title: "T" }), true);
  assert.equal(unasked({ kind: "user" }), false);
  assert.equal(
    unasked({
      kind: "channel",
      channel: "telegram",
      conversation: "1",
      person_id: "p",
      name: "Owner",
      role: "owner",
    }),
    false,
  );
});

const llm = scriptedLlm(() => say("Llegó lo de Northwind."));
let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  env = await startCore({ llm });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

/** Runs a routine now and returns the input its model call got. */
async function routineInput(prompt: string): Promise<string> {
  const r = await env.client.call("routines.set", {
    name: prompt,
    agent: "roby",
    schedule: { kind: "manual" },
    prompt,
  });
  await env.client.call("routines.run", { routine: r.id });
  const call = await waitFor(
    () => llm.calls.find((c) => String(c.messages.at(-1)?.content ?? "").includes(prompt)),
    "the routine's call",
  );
  return String(call.messages.at(-1)?.content ?? "");
}

test("the scripted model sees the last talk and the greeting rule on a routine, never on the owner's turn", async () => {
  const store = env.core.store;
  store.messages.add({
    thread_id: "home",
    author: { kind: "user" },
    parts: [{ type: "text", text: "buenas" }],
    at: new Date(Date.now() - 9 * HOUR).toISOString(),
  });
  const quiet = await routineInput("check the Northwind inbox");
  assert.match(quiet, /\[last talk\] The owner last wrote 9 h ago: "buenas"\./);
  assert.match(quiet, GREET);

  await env.client.call("threads.send", { thread: "home", text: "¿Llegó algo de Northwind?" });
  await env.settle("home");
  const ownerTurn = String(llm.calls.at(-1)?.messages.findLast((m) => m.role === "user")?.content ?? "");
  assert.doesNotMatch(ownerTurn, /\[last talk\]/, "the owner's own message needs no such line");

  const soon = await routineInput("look at the Northwind inbox");
  assert.match(soon, /The owner last wrote \d+ min ago: "¿Llegó algo de Northwind\?"\./);
  assert.match(soon, GO_ON);
  assert.doesNotMatch(soon, GREET);
});
