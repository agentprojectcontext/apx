// Delegations past the cap from one thread wait in a durable queue: they start when a slot frees, report back like
// any other, die with their caller and outlive a restart.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Part } from "@apx/protocol";
import type { RunRecord } from "../domain/runs.ts";
import type { Store } from "../domain/store.ts";
import type { AssistantItem, ChatItem } from "../providers/types.ts";
import { waitFor } from "../testkit/platform.ts";
import { MAX_ACTIVE_DELEGATIONS } from "./limits.ts";
import { callTool, say, scriptedLlm, startCore, texts } from "./testkit.ts";

const PARTS = Array.from({ length: MAX_ACTIVE_DELEGATIONS + 1 }, (_, i) => `part-${i + 1}`);
const FIVE = Array.from({ length: MAX_ACTIVE_DELEGATIONS + 2 }, (_, i) => `part-${i + 1}`);

/** One delegate call of the fan-out: the session it names and the key its task carries. */
type Ask = { session: string; key: string };

type GateOpts = {
  /** The fan-out, in order (default: one session per part of PARTS). */
  asks?: Ask[];
  /** More keys Scout may be asked about outside the fan-out. */
  keys?: string[];
  /** Keys whose turn fails once let go. */
  fail?: string[];
  /** Keys whose turn asks the owner first, and waits. */
  askOwner?: string[];
  /** The caller's turn stays open after the fan-out until it is stopped. */
  holdCaller?: boolean;
};

const ofParts = (parts: string[]): Ask[] => parts.map((p) => ({ session: p, key: p }));

/** Scout holds each key until the test lets it answer (or its turn is stopped). */
function gated(o: GateOpts = {}) {
  const asks = o.asks ?? ofParts(PARTS);
  const keys = [...new Set([...asks.map((a) => a.key), ...(o.keys ?? [])])];
  const gates = new Map<string, () => void>();
  const waits = new Map<string, Promise<void>>();
  for (const k of keys) waits.set(k, new Promise<void>((r) => gates.set(k, r)));
  const asked: string[] = [];
  const at = { now: 0, peak: 0 };
  const llm = scriptedLlm(async (req, { system, said, afterTool }) => {
    // Made only where it is awaited: a rejection nobody waits for fails the test.
    const aborted = () =>
      new Promise<void>((_, reject) => {
        if (req.signal.aborted) reject(req.signal.reason);
        req.signal.addEventListener("abort", () => reject(req.signal.reason), { once: true });
      });
    if (system.startsWith("You are Scout")) {
      // The task it was given last (a resumed turn's last words are APX's note, not the task).
      const task = req.messages.findLast((m) => m.role === "user" && /look into [\w-]+/.test(String(m.content)));
      const key = String(task?.content ?? said).match(/look into ([\w-]+)/)?.[1] ?? "";
      if (o.askOwner?.includes(key) && !afterTool) {
        asked.push(key);
        return callTool(`q-${key}`, "ask_owner", {
          question: `Which environment should the ${key} audit cover, staging or production?`,
        });
      }
      asked.push(key);
      at.peak = Math.max(at.peak, ++at.now);
      try {
        await Promise.race([waits.get(key), aborted()]);
      } finally {
        at.now--;
      }
      if (o.fail?.includes(key)) throw new Error(`the provider refused the ${key} request`);
      return say(`Scout's findings on ${key}.`);
    }
    if (said.includes("<delegation_result")) return say(`Noted: ${said.match(/part-\d/)?.[0] ?? "?"}`);
    if (afterTool) {
      if (o.holdCaller) await aborted();
      return say("Fanned out.");
    }
    if (said.includes("fan out")) {
      const message: AssistantItem = {
        role: "assistant",
        content: null,
        tool_calls: asks.map((a, i) => ({
          id: `d${i}`,
          type: "function",
          function: {
            name: "delegate",
            arguments: JSON.stringify({ agent: "scout", session: a.session, task: `look into ${a.key}`, wait_s: 0 }),
          },
        })),
      };
      return { message };
    }
    return say("ok");
  });
  const open = (k: string) => gates.get(k)?.();
  const openAll = () => {
    for (const k of keys) open(k);
  };
  return { llm, asked, at, open, openAll };
}

const pause = (ms = 100) => new Promise((r) => setTimeout(r, ms));

type Env = Awaited<ReturnType<typeof startCore>>;
const sessions = (env: Env, parent: string) =>
  env.core.store.threads.sessions(parent).map((t) => ({ t, run: env.core.store.runs.list(t.id, 1)[0] }));
const session = (env: Env, parent: string, name: string) => {
  const s = sessions(env, parent).find((x) => x.t.session === name);
  assert.ok(s, `session ${name}`);
  return s;
};
const cards = (env: Env, parent: string) =>
  env.core.store.messages
    .list(parent)
    .flatMap((m) => m.parts)
    .filter((p): p is Extract<Part, { type: "subthread" }> => p.type === "subthread");

async function fanOut(env: Env, done = true) {
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", title: "audit" });
  await env.client.call("threads.send", { thread: t.id, text: "fan out" });
  if (done) await waitFor(() => env.core.store.runs.list(t.id, 1)[0]?.state === "completed", "the caller's turn");
  return t.id;
}

async function withCore(o: GateOpts, body: (env: Env, g: ReturnType<typeof gated>) => Promise<void>) {
  const g = gated(o);
  const env = await startCore({ llm: g.llm });
  try {
    await body(env, g);
  } finally {
    g.openAll();
    await env.core.close();
    await env.cleanup();
  }
}

test("a delegation past the cap is queued, starts when one finishes, and its result reaches the caller", async () => {
  await withCore({}, async (env, g) => {
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
    await waitFor(() => g.asked.length === MAX_ACTIVE_DELEGATIONS, "three at work");

    const first = subs.find((s) => s !== waiting && s.t.session);
    g.open(first?.t.session ?? "");
    await waitFor(() => g.asked.length === PARTS.length, "the queued one starting");
    assert.equal(cards(env, parent).find((c) => c.thread_id === waiting.t.id)?.state, "working");

    g.openAll();
    const done = await env.settle(waiting.t.id);
    assert.equal(done.runs[0]?.state, "completed");
    await waitFor(() => {
      const woken = env.core.store.runs.list(parent, 20).filter((r) => r.trigger === "a2a_result");
      return woken.length === PARTS.length && woken.every((r) => r.state === "completed");
    }, "every result delivered");
    const delivered = env.core.store.runs
      .list(parent, 20)
      .filter((r) => r.trigger === "a2a_result")
      .map((r) => (r.input?.origin.kind === "delegation_result" ? r.input.origin.thread_id : ""));
    assert.ok(delivered.includes(waiting.t.id), "the queued one reports back like the others");
    assert.equal(cards(env, parent).find((c) => c.thread_id === waiting.t.id)?.state, "completed");
  });
});

test("stopping the caller's thread cancels a queued delegation instead of starting it", async () => {
  await withCore({}, async (env, g) => {
    const parent = await fanOut(env);
    await waitFor(() => g.asked.length === MAX_ACTIVE_DELEGATIONS, "three at work");
    const waiting = sessions(env, parent).find((s) => s.run?.state === "queued");
    assert.ok(waiting);
    await env.client.call("threads.cancel", { thread: parent });
    await waitFor(() => sessions(env, parent).every((s) => s.run?.state === "canceled"), "every session ended");
    await pause();
    assert.equal(g.asked.length, MAX_ACTIVE_DELEGATIONS, "the queued one never started");
    assert.equal(cards(env, parent).find((c) => c.thread_id === waiting.t.id)?.state, "canceled");
    assert.ok(!env.core.store.runs.list(parent, 20).some((r) => r.trigger === "a2a_result"), "nobody is woken");
  });
});

test("stopping the caller's turn while it is still working cancels its queued delegations", async () => {
  await withCore({ asks: ofParts(FIVE), holdCaller: true }, async (env, g) => {
    const parent = await fanOut(env, false);
    await waitFor(() => g.asked.length === MAX_ACTIVE_DELEGATIONS, "three at work");
    await waitFor(() => sessions(env, parent).filter((s) => s.run?.state === "queued").length === 2, "two queued");
    assert.equal(env.core.store.runs.list(parent, 1)[0]?.state, "working", "the caller is mid-turn");
    await env.client.call("threads.cancel", { thread: parent });
    await waitFor(() => sessions(env, parent).every((s) => s.run?.state === "canceled"), "every session ended");
    await pause();
    assert.equal(g.asked.length, MAX_ACTIVE_DELEGATIONS, "no queued one started");
    assert.equal(env.core.store.runs.list(parent, 1)[0]?.state, "canceled");
  });
});

test("jobs.cancel on a queued delegation ends it for whoever waits on it", async () => {
  await withCore({}, async (env, g) => {
    const parent = await fanOut(env);
    await waitFor(() => g.asked.length === MAX_ACTIVE_DELEGATIONS, "three at work");
    const waiting = sessions(env, parent).find((s) => s.run?.state === "queued");
    assert.ok(waiting?.run);
    const waited = env.core.engine.wait(waiting.run.id, 3000);
    assert.deepEqual(await env.client.call("jobs.cancel", { job: waiting.run.id }), { canceled: true });
    assert.equal((await waited)?.state, "canceled");
    assert.equal(cards(env, parent).find((c) => c.thread_id === waiting.t.id)?.state, "canceled");
    g.open("part-1");
    await waitFor(() => session(env, parent, "part-1").run?.state === "completed", "part-1 done");
    await pause();
    assert.equal(g.asked.length, MAX_ACTIVE_DELEGATIONS, "the canceled one never started");
  });
});

test("a slot freed by a failed or canceled delegation starts the oldest queued one", async () => {
  await withCore({ asks: ofParts(FIVE), fail: ["part-1"] }, async (env, g) => {
    const parent = await fanOut(env);
    await waitFor(() => g.asked.length === MAX_ACTIVE_DELEGATIONS, "three at work");
    g.open("part-1");
    await waitFor(() => session(env, parent, "part-1").run?.state === "failed", "part-1 failed");
    await waitFor(() => g.asked.length === MAX_ACTIVE_DELEGATIONS + 1, "the next one starting");
    assert.equal(g.asked.at(-1), "part-4", "the oldest goes first");
    assert.equal(session(env, parent, "part-5").run?.state, "queued");

    await env.client.call("threads.cancel", { thread: session(env, parent, "part-2").t.id });
    await waitFor(() => g.asked.length === FIVE.length, "the last one starting");
    assert.equal(g.asked.at(-1), "part-5");
    assert.ok(g.at.peak <= MAX_ACTIVE_DELEGATIONS, `at most ${MAX_ACTIVE_DELEGATIONS} at once (saw ${g.at.peak})`);
  });
});

test("a delegation waiting for the owner's answer frees its slot", async () => {
  await withCore({ askOwner: ["part-1"] }, async (env, g) => {
    const parent = await fanOut(env);
    await waitFor(() => session(env, parent, "part-1").run?.state === "input-required", "part-1 asking the owner");
    await waitFor(() => g.asked.length === PARTS.length, "the queued one starting");
    assert.notEqual(session(env, parent, "part-4").run?.state, "queued");
    assert.equal(session(env, parent, "part-1").run?.state, "input-required", "it still waits for the owner");
  });
});

test("a turn in a session that no delegation started frees its slot when it ends", async () => {
  const asks = ofParts(["part-1", "part-2", "part-3", "part-4"]);
  await withCore({ asks, keys: ["side"] }, async (env, g) => {
    const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", title: "audit" });
    const side = env.core.store.threads.create({
      kind: "a2a",
      title: "Side session",
      agent_ids: ["scout", "roby"],
      parent_id: t.id,
      session: "side",
    });
    env.core.engine.admit({
      thread_id: side.id,
      agent_id: "scout",
      trigger: "user",
      origin: { kind: "user" },
      text: "look into side",
    });
    await waitFor(() => g.asked.includes("side"), "the side turn working");
    await env.client.call("threads.send", { thread: t.id, text: "fan out" });
    await waitFor(() => env.core.store.runs.list(t.id, 1)[0]?.state === "completed", "the caller's turn");
    await waitFor(() => g.asked.length === 3, "two delegations at work");
    assert.equal(sessions(env, t.id).filter((s) => s.run?.state === "queued").length, 2);
    g.open("side");
    await waitFor(() => g.asked.length === 4, "one queued starting once the side turn ends");
    assert.equal(g.asked.at(-1), "part-3");
  });
});

test("a queued task for a session still at work leaves that session showing it works", async () => {
  const asks = [...ofParts(["part-1", "part-2", "part-3"]), { session: "part-1", key: "extra" }];
  await withCore({ asks }, async (env, g) => {
    const parent = await fanOut(env);
    await waitFor(() => g.asked.length === MAX_ACTIVE_DELEGATIONS, "three at work");
    const busy = session(env, parent, "part-1");
    const extra = env.core.store.runs.list(busy.t.id, 5).find((r) => r.state === "queued");
    assert.ok(extra, "the second task for part-1 is queued");
    g.open("part-2");
    await waitFor(() => env.core.store.runs.get(extra.id)?.state !== "queued", "the extra task released");
    assert.equal(env.core.store.threads.get(busy.t.id)?.state, "working", "the session still shows it works");
    g.open("part-1");
    g.open("extra");
    await waitFor(() => env.core.store.runs.get(extra.id)?.state === "completed", "the extra task done");
  });
});

for (const kind of ["chain", "agent"] as const)
  test(`a queued delegation waits while the ${kind} budget is spent, and starts once the owner ${kind === "chain" ? "lets agents go on" : "writes"}`, async () => {
    await withCore({}, async (env, g) => {
      const parent = await fanOut(env);
      await waitFor(() => g.asked.length === MAX_ACTIVE_DELEGATIONS, "three at work");
      if (kind === "chain") await env.client.call("agents.set_limits", { runs: MAX_ACTIVE_DELEGATIONS, tokens: 0 });
      else
        await env.client.call("agents.set_agent_limits", {
          agent: "scout",
          limits: { runs: MAX_ACTIVE_DELEGATIONS },
        });
      g.open("part-1");
      g.open("part-2");
      await waitFor(
        () => ["part-1", "part-2"].every((p) => session(env, parent, p).run?.state === "completed"),
        "two done",
      );
      await pause();
      assert.equal(session(env, parent, "part-4").run?.state, "queued", "the breaker holds it");
      assert.equal(g.asked.length, MAX_ACTIVE_DELEGATIONS);
      const held = env.core.store.messages
        .list(parent)
        .flatMap((m) => m.parts)
        .filter((p) => p.type === "notice" && p.code === "breaker.held");
      assert.equal(held.length, 1, "the owner sees why, once");

      if (kind === "chain") await env.client.call("threads.go_on", { thread: parent, mode: "reset" });
      else await env.client.call("threads.send", { thread: parent, text: "Carry on with the audit." });
      await waitFor(() => g.asked.length === PARTS.length, "the queued one starting");
    });
  });

/** Seeds a delegation per state, as a killed process leaves them: the caller's turn already ended. */
function seedCut(store: Store, states: Array<"working" | "input-required" | "queued">) {
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
  const delegated = states.map((state, i) => {
    const p = `part-${i + 1}`;
    const sub = store.threads.create({
      kind: "a2a",
      title: `Roby → Scout: ${p}`,
      agent_ids: ["scout", "roby"],
      parent_id: parentThread.id,
      session: p,
    });
    const queued = state === "queued";
    let run: RunRecord = store.runs.create({
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
    if (!queued) {
      run = store.runs.setState(store.runs.setState(run, "working"), state);
      // What the cut turn had read: a resumed one carries on from it.
      store.modelLog.append(sub.id, run.id, [{ role: "user", content: `look into ${p}` }]);
    }
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
  return { parentThread, delegated };
}

test("a queued delegation survives a restart and still waits for a free slot", async () => {
  const llm = scriptedLlm((_req, { system, said }) => {
    if (system.startsWith("You are Scout")) return say(`Scout's findings on ${said.match(/part-\d/)?.[0] ?? "?"}.`);
    if (said.includes("<delegation_result")) return say(`Noted: ${said.match(/part-\d/)?.[0] ?? "?"}`);
    return say("ok");
  });
  const first = await startCore({ llm });
  const { parentThread, delegated } = seedCut(first.core.store, ["working", "working", "working", "queued"]);
  await first.core.close();

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
    await waitFor(
      () =>
        second.core.store.runs
          .list(parentThread.id, 20)
          .some((r) => r.trigger === "a2a_result" && r.state === "completed" && r.input?.text.includes("part-4")),
      "its result delivered",
    );
    const final = await second.settle(parentThread.id);
    assert.ok(texts(final.messages).includes("Noted: part-4"));
  } finally {
    await second.core.close();
    await second.cleanup();
  }
});

test("the boot never runs more delegations at once than the cap", async () => {
  const g = gated({ asks: ofParts(FIVE) });
  const first = await startCore({ llm: g.llm });
  // One cut while it asked the owner (not resumed), two cut mid-work (resumed), two queued.
  const { parentThread } = seedCut(first.core.store, ["input-required", "working", "working", "queued", "queued"]);
  await first.core.close();

  const second = await startCore({ llm: g.llm, home: first.home });
  const { store } = second.core;
  try {
    assert.ok(
      store.runs.activeDelegations(parentThread.id) <= MAX_ACTIVE_DELEGATIONS,
      `at most ${MAX_ACTIVE_DELEGATIONS} admitted (saw ${store.runs.activeDelegations(parentThread.id)})`,
    );
    await waitFor(() => g.asked.length === MAX_ACTIVE_DELEGATIONS, "three at work");
    await pause();
    assert.equal(g.asked.length, MAX_ACTIVE_DELEGATIONS);
    assert.deepEqual(g.asked.toSorted(), ["part-2", "part-3", "part-4"], "the resumed two and the oldest queued");
    g.open("part-2");
    await waitFor(() => g.asked.includes("part-5"), "the last one starting");
    assert.ok(g.at.peak <= MAX_ACTIVE_DELEGATIONS, `at most ${MAX_ACTIVE_DELEGATIONS} at once (saw ${g.at.peak})`);
  } finally {
    g.openAll();
    await second.core.close();
    await second.cleanup();
  }
});
