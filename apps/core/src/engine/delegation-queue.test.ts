// Delegations past the cap from one thread wait in a durable queue: they start when a slot frees, report back like
// any other, die with their caller and outlive a restart.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Part } from "@apx/protocol";
import type { AssistantItem, ChatItem } from "../providers/types.ts";
import { MAX_ACTIVE_DELEGATIONS } from "./limits.ts";
import { say, scriptedLlm, startCore, texts } from "./testkit.ts";

const PARTS = Array.from({ length: MAX_ACTIVE_DELEGATIONS + 1 }, (_, i) => `part-${i + 1}`);

/** Scout holds each part until the test lets it answer (or its turn is stopped). */
function gated() {
  const gates = new Map<string, () => void>();
  const waits = new Map<string, Promise<void>>();
  for (const p of PARTS) waits.set(p, new Promise<void>((r) => gates.set(p, r)));
  const asked: string[] = [];
  const llm = scriptedLlm(async (req, { system, said, afterTool }) => {
    if (system.startsWith("You are Scout")) {
      const part = PARTS.find((p) => said.includes(p)) ?? "";
      asked.push(part);
      const aborted = new Promise<void>((_, reject) =>
        req.signal.addEventListener("abort", () => reject(req.signal.reason), { once: true }),
      );
      await Promise.race([waits.get(part), aborted]);
      return say(`Scout's findings on ${part}.`);
    }
    if (said.includes("<delegation_result")) return say(`Noted: ${said.match(/part-\d/)?.[0] ?? "?"}`);
    if (afterTool) return say("Fanned out.");
    if (said.includes("fan out")) {
      const message: AssistantItem = {
        role: "assistant",
        content: null,
        tool_calls: PARTS.map((p, i) => ({
          id: `d${i}`,
          type: "function",
          function: {
            name: "delegate",
            arguments: JSON.stringify({ agent: "scout", session: p, task: `look into ${p}`, wait_s: 0 }),
          },
        })),
      };
      return { message };
    }
    return say("ok");
  });
  return { llm, asked, open: (p: string) => gates.get(p)?.() };
}

const until = async (what: string, ok: () => boolean, ms = 5000) => {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
};

type Env = Awaited<ReturnType<typeof startCore>>;
const sessions = (env: Env, parent: string) =>
  env.core.store.threads.sessions(parent).map((t) => ({ t, run: env.core.store.runs.list(t.id, 1)[0] }));
const cards = (env: Env, parent: string) =>
  env.core.store.messages
    .list(parent)
    .flatMap((m) => m.parts)
    .filter((p): p is Extract<Part, { type: "subthread" }> => p.type === "subthread");

async function fanOut(env: Env) {
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", title: "audit" });
  await env.client.call("threads.send", { thread: t.id, text: "fan out" });
  await until("the caller's turn", () => env.core.store.runs.list(t.id, 1)[0]?.state === "completed");
  return t.id;
}

test("a delegation past the cap is queued, starts when one finishes, and its result reaches the caller", async () => {
  const g = gated();
  const env = await startCore({ llm: g.llm });
  try {
    const parent = await fanOut(env);
    const subs = sessions(env, parent);
    assert.equal(subs.length, PARTS.length);
    const queued = subs.filter((s) => s.run?.state === "queued");
    assert.equal(queued.length, 1, "one waits for a slot");
    const waiting = queued[0];
    assert.ok(waiting);
    assert.equal(waiting.t.state, "queued", "its session shows as queued");
    assert.equal(cards(env, parent).find((c) => c.thread_id === waiting.t.id)?.state, "queued");
    const results = env.core.store.modelLog
      .list(parent)
      .map(({ item }) => item as ChatItem)
      .flatMap((m) => (m.role === "tool" ? [String(m.content)] : []));
    assert.equal(results.filter((r) => r.startsWith("queued:")).length, 1, "the tool says it is queued");
    assert.ok(!results.some((r) => r.startsWith("refused")));
    await until("three at work", () => g.asked.length === MAX_ACTIVE_DELEGATIONS);

    const first = subs.find((s) => s !== waiting && s.t.session);
    g.open(first?.t.session ?? "");
    await until("the queued one starting", () => g.asked.length === PARTS.length);
    assert.equal(cards(env, parent).find((c) => c.thread_id === waiting.t.id)?.state, "working");

    for (const p of PARTS) g.open(p);
    const done = await env.settle(waiting.t.id);
    assert.equal(done.runs[0]?.state, "completed");
    await until("every result delivered", () => {
      const woken = env.core.store.runs.list(parent, 20).filter((r) => r.trigger === "a2a_result");
      return woken.length === PARTS.length && woken.every((r) => r.state === "completed");
    });
    const delivered = env.core.store.runs
      .list(parent, 20)
      .filter((r) => r.trigger === "a2a_result")
      .map((r) => (r.input?.origin.kind === "delegation_result" ? r.input.origin.thread_id : ""));
    assert.ok(delivered.includes(waiting.t.id), "the queued one reports back like the others");
    assert.equal(cards(env, parent).find((c) => c.thread_id === waiting.t.id)?.state, "completed");
  } finally {
    for (const p of PARTS) g.open(p);
    await env.core.close();
    env.cleanup();
  }
});

test("stopping the caller's thread cancels a queued delegation instead of starting it", async () => {
  const g = gated();
  const env = await startCore({ llm: g.llm });
  try {
    const parent = await fanOut(env);
    await until("three at work", () => g.asked.length === MAX_ACTIVE_DELEGATIONS);
    const waiting = sessions(env, parent).find((s) => s.run?.state === "queued");
    assert.ok(waiting);
    await env.client.call("threads.cancel", { thread: parent });
    await until("every session ended", () => sessions(env, parent).every((s) => s.run?.state === "canceled"));
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(g.asked.length, MAX_ACTIVE_DELEGATIONS, "the queued one never started");
    assert.equal(cards(env, parent).find((c) => c.thread_id === waiting.t.id)?.state, "canceled");
    assert.ok(!env.core.store.runs.list(parent, 20).some((r) => r.trigger === "a2a_result"), "nobody is woken");
  } finally {
    for (const p of PARTS) g.open(p);
    await env.core.close();
    env.cleanup();
  }
});

test("a queued delegation survives a restart and still waits for a free slot", async () => {
  const llm = scriptedLlm((_req, { system, said }) => {
    if (system.startsWith("You are Scout")) return say(`Scout's findings on ${said.match(/part-\d/)?.[0] ?? "?"}.`);
    if (said.includes("<delegation_result")) return say(`Noted: ${said.match(/part-\d/)?.[0] ?? "?"}`);
    return say("ok");
  });
  // ── before the restart: three delegations cut mid-work and one queued, as a killed process leaves them ──
  const first = await startCore({ llm });
  const { store } = first.core;
  const deadline = new Date(Date.now() + 60_000).toISOString();
  const parentThread = store.threads.create({ kind: "loose", title: "parent", agent_ids: ["roby"] });
  let parent = store.runs.create({
    thread_id: parentThread.id,
    agent_id: "roby",
    trigger: "user",
    input: { origin: { kind: "user" }, text: "fan out" },
    deadline_at: deadline,
  });
  parent = store.runs.setState(store.runs.setState(parent, "working"), "completed");
  const delegated = PARTS.map((p, i) => {
    const sub = store.threads.create({
      kind: "a2a",
      title: `Roby → Scout: ${p}`,
      agent_ids: ["scout", "roby"],
      parent_id: parentThread.id,
      session: p,
    });
    const queued = i === PARTS.length - 1;
    const run = store.runs.create({
      thread_id: sub.id,
      agent_id: "scout",
      trigger: "a2a",
      input: {
        origin: { kind: "agent", id: "roby", name: "Roby", thread_id: parentThread.id, run_id: parent.id },
        text: `look into ${p}`,
      },
      parent_run_id: parent.id,
      depth: 1,
      deadline_at: deadline,
      ...(queued ? { state: "queued" as const } : {}),
    });
    if (!queued) store.runs.setState(run, "working");
    return { sub, run };
  });
  const msg = store.messages.add({
    thread_id: parentThread.id,
    author: { kind: "agent", id: "roby" },
    run_id: parent.id,
    parts: delegated.map(({ sub, run }) => ({
      type: "subthread" as const,
      thread_id: sub.id,
      agent_id: "scout",
      title: sub.title,
      state: run.state,
    })),
  });
  store.runs.patch(parent, { message_id: msg.id });
  await first.core.close();

  // ── after the restart ──
  const second = await startCore({ llm, home: first.home });
  try {
    const last = delegated.at(-1);
    assert.ok(last);
    const queuedNow = await second.settle(last.sub.id);
    const started = queuedNow.runs.find((r) => r.id === last.run.id);
    assert.equal(started?.state, "completed", "the queued one ran after the restart");
    const freed = delegated
      .slice(0, -1)
      .map(({ sub }) => second.core.store.runs.list(sub.id, 5).find((r) => r.state === "completed")?.ended_at ?? "");
    assert.ok(
      freed.some((at) => at && at <= (started?.started_at ?? "")),
      "it started only once a resumed delegation had finished",
    );
    await until("its result delivered", () =>
      second.core.store.runs
        .list(parentThread.id, 20)
        .some((r) => r.trigger === "a2a_result" && r.state === "completed" && r.input?.text.includes("part-4")),
    );
    const final = await second.settle(parentThread.id);
    assert.ok(texts(final.messages).includes("Noted: part-4"));
  } finally {
    await second.core.close();
    second.cleanup();
  }
});
