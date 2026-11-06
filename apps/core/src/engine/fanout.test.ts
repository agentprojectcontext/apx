// An agent that asks two or more teammates in one turn hears all their answers in one turn: each answer is held until
// the others are in or the hold runs out, through restarts and in any order; a single delegation is unchanged.
// See DECISIONS.md#d-194
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Part } from "@apx/protocol";
import type { RunRecord } from "../domain/runs.ts";
import type { LlmRequest } from "../providers/llm.ts";
import type { AssistantItem } from "../providers/types.ts";
import { type ManualTimers, manualTimers, waitFor } from "../testkit/platform.ts";
import { FANOUT_HOLD_MS } from "./limits.ts";
import { say, scriptedLlm, startCore } from "./testkit.ts";

/** Scout holds each key until the test lets it answer; the caller asks for `keys` in one step. */
function gated(keys: string[]) {
  const gates = new Map<string, () => void>();
  const waits = new Map<string, Promise<void>>();
  for (const k of keys) waits.set(k, new Promise<void>((r) => gates.set(k, r)));
  const asked: string[] = [];
  /** What each turn of the caller woken by results read. */
  const woken: string[] = [];
  const llm = scriptedLlm(async (req: LlmRequest, { system, said, afterTool }) => {
    if (system.startsWith("You are Scout")) {
      const task = req.messages.findLast((m) => m.role === "user" && /look into [\w-]+/.test(String(m.content)));
      const key = String(task?.content ?? said).match(/look into ([\w-]+)/)?.[1] ?? "";
      asked.push(key);
      await Promise.race([
        waits.get(key),
        new Promise<void>((_, reject) => {
          if (req.signal.aborted) reject(req.signal.reason);
          req.signal.addEventListener("abort", () => reject(req.signal.reason), { once: true });
        }),
      ]);
      return say(`Scout's findings on ${key}.`);
    }
    if (said.includes("<delegation_result")) {
      woken.push(said);
      return say(`Noted ${[...said.matchAll(/findings on ([\w-]+)/g)].map((m) => m[1]).join(" + ")}`);
    }
    if (afterTool) return say("Asked them.");
    if (said.startsWith("fan out")) {
      const message: AssistantItem = {
        role: "assistant",
        content: null,
        tool_calls: keys.map((k, i) => ({
          id: `d${i}`,
          type: "function",
          function: {
            name: "delegate",
            arguments: JSON.stringify({ agent: "scout", session: k, task: `look into ${k}`, wait_s: 0 }),
          },
        })),
      };
      return { message };
    }
    return say("ok");
  });
  return {
    llm,
    asked,
    woken,
    open: (k: string) => gates.get(k)?.(),
    openAll: () => {
      for (const k of keys) gates.get(k)?.();
    },
  };
}

type Env = Awaited<ReturnType<typeof startCore>>;
const results = (env: Env, parent: string): RunRecord[] =>
  env.core.store.runs
    .list(parent, 50)
    .filter((r) => r.trigger === "a2a_result")
    .toReversed();
const cards = (env: Env, parent: string) =>
  env.core.store.messages
    .list(parent)
    .flatMap((m) => m.parts)
    .filter((p): p is Extract<Part, { type: "subthread" }> => p.type === "subthread");
const card = (env: Env, parent: string, session: string) => {
  const sub = env.core.store.threads.sessions(parent).find((t) => t.session === session);
  return cards(env, parent).find((c) => c.thread_id === sub?.id);
};
const answered = (env: Env, parent: string, session: string) =>
  waitFor(() => card(env, parent, session)?.state === "completed", `${session} answering`);
/** The keys a result turn carries, in the order it lists them. */
const carried = (run: RunRecord | undefined): string[] => {
  const o = run?.input?.origin;
  if (o?.kind === "delegation_result") return [run?.input?.text.match(/findings on ([\w-]+)/)?.[1] ?? "?"];
  if (o?.kind === "delegation_results") return o.results.map((r) => r.answer.match(/findings on ([\w-]+)/)?.[1] ?? "?");
  return [];
};
const pause = (ms = 150) => new Promise((r) => setTimeout(r, ms));

async function fanOut(env: Env, n: number) {
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "superagent", title: "audit" });
  await env.client.call("threads.send", { thread: t.id, text: "fan out" });
  await waitFor(() => env.core.store.runs.list(t.id, 1)[0]?.state === "completed", "the caller's turn");
  await waitFor(() => env.core.store.threads.sessions(t.id).length === n, "its sessions");
  return t.id;
}

async function withCore(
  keys: string[],
  body: (env: Env, g: ReturnType<typeof gated>, timers: ManualTimers) => Promise<void>,
) {
  const g = gated(keys);
  const timers = manualTimers();
  const env = await startCore({ llm: g.llm, fanoutTimers: timers });
  try {
    await body(env, g, timers);
  } finally {
    g.openAll();
    await env.core.close();
    await env.cleanup();
  }
}

test("three teammates asked in one step answer the caller in one turn", async () => {
  await withCore(["alpha", "beta", "gamma"], async (env, g) => {
    const parent = await fanOut(env, 3);
    await waitFor(() => g.asked.length === 3, "all three at work");
    g.open("alpha");
    await answered(env, parent, "alpha");
    g.open("beta");
    await answered(env, parent, "beta");
    await pause();
    assert.equal(results(env, parent).length, 0, "no turn while one is still at work");
    assert.deepEqual(card(env, parent, "beta")?.held, { got: 2, of: 3 }, "the card says how many are in");
    assert.deepEqual(card(env, parent, "alpha")?.held, { got: 2, of: 3 });
    assert.equal(card(env, parent, "gamma")?.held, undefined, "one still at work shows it works");

    g.open("gamma");
    await waitFor(() => results(env, parent)[0]?.state === "completed", "the combined turn");
    await pause();
    const woke = results(env, parent);
    assert.equal(woke.length, 1, "one turn for all three");
    assert.deepEqual(carried(woke[0]), ["alpha", "beta", "gamma"], "in the order they were asked");
    assert.equal(g.woken.length, 1);
    assert.equal(g.woken[0]?.match(/<delegation_result /g)?.length, 3, "each answer is its own observation");
    for (const s of ["alpha", "beta", "gamma"])
      assert.equal(card(env, parent, s)?.held, undefined, `${s} no longer held`);
    assert.equal(env.core.store.threads.context(parent).fanout, undefined, "nothing left held");
  });
});

test("answers arriving in any order still make one turn", async () => {
  await withCore(["alpha", "beta", "gamma"], async (env, g) => {
    const parent = await fanOut(env, 3);
    await waitFor(() => g.asked.length === 3, "all three at work");
    for (const k of ["gamma", "alpha", "beta"]) {
      g.open(k);
      await answered(env, parent, k);
    }
    await waitFor(() => results(env, parent)[0]?.state === "completed", "the combined turn");
    await pause();
    assert.equal(results(env, parent).length, 1);
    assert.deepEqual(carried(results(env, parent)[0]), ["alpha", "beta", "gamma"]);
  });
});

test("past the hold the answers in go together, and a late one gets its own turn as before", async () => {
  await withCore(["alpha", "beta", "gamma"], async (env, g, timers) => {
    const parent = await fanOut(env, 3);
    await waitFor(() => g.asked.length === 3, "all three at work");
    g.open("alpha");
    await answered(env, parent, "alpha");
    g.open("beta");
    await answered(env, parent, "beta");
    await pause();
    assert.equal(results(env, parent).length, 0);
    timers.tick(FANOUT_HOLD_MS - 1);
    await pause();
    assert.equal(results(env, parent).length, 0, "not before the hold runs out");
    timers.tick(1);
    await waitFor(() => results(env, parent)[0]?.state === "completed", "the turn with the two in");
    assert.deepEqual(carried(results(env, parent)[0]), ["alpha", "beta"]);
    assert.equal(card(env, parent, "alpha")?.held, undefined);

    g.open("gamma");
    await waitFor(
      () => results(env, parent).length === 2 && results(env, parent)[1]?.state === "completed",
      "the late one",
    );
    const late = results(env, parent)[1];
    assert.equal(late?.input?.origin.kind, "delegation_result", "the late answer comes on its own, as before");
    assert.deepEqual(carried(late), ["gamma"]);
    assert.equal(env.core.store.threads.context(parent).fanout, undefined, "the group is gone once all answered");
  });
});

test("a single delegation reports back exactly as before", async () => {
  await withCore(["alpha"], async (env, g, timers) => {
    const parent = await fanOut(env, 1);
    await waitFor(() => g.asked.length === 1, "at work");
    g.open("alpha");
    await waitFor(() => results(env, parent)[0]?.state === "completed", "its result turn");
    const woke = results(env, parent);
    assert.equal(woke.length, 1);
    assert.equal(woke[0]?.input?.origin.kind, "delegation_result");
    assert.equal(timers.pending(), 0, "nothing held, no hold timer");
    assert.equal(card(env, parent, "alpha")?.held, undefined);
    assert.equal(env.core.store.threads.context(parent).fanout, undefined);
  });
});

test("stopping the caller's chat mid-group wakes nobody and lets go of what was held", async () => {
  await withCore(["alpha", "beta", "gamma"], async (env, g, timers) => {
    const parent = await fanOut(env, 3);
    await waitFor(() => g.asked.length === 3, "all three at work");
    g.open("alpha");
    await answered(env, parent, "alpha");
    await waitFor(() => card(env, parent, "alpha")?.held !== undefined, "alpha held");
    await env.client.call("threads.cancel", { thread: parent });
    await waitFor(
      () => env.core.store.threads.sessions(parent).every((t) => env.core.store.runs.list(t.id, 1)[0]?.ended_at),
      "the others stopped",
    );
    timers.tick(FANOUT_HOLD_MS);
    await pause();
    assert.equal(results(env, parent).length, 0, "the owner stopped it: no turn starts");
    assert.equal(env.core.store.threads.context(parent).fanout, undefined);
    assert.equal(card(env, parent, "alpha")?.held, undefined, "its card no longer says it waits");
    assert.equal(timers.pending(), 0, "its hold timer is gone");
  });
});

test("a restart mid-group keeps what was held and still makes one turn", async () => {
  const keys = ["alpha", "beta", "gamma"];
  const g = gated(keys);
  const first = await startCore({ llm: g.llm, fanoutTimers: manualTimers() });
  let parent = "";
  try {
    parent = await fanOut(first, 3);
    await waitFor(() => g.asked.length === 3, "all three at work");
    g.open("alpha");
    await answered(first, parent, "alpha");
    await waitFor(() => first.core.store.threads.context(parent).fanout?.[0]?.held.length === 1, "alpha held");
  } finally {
    await first.core.close();
  }
  const g2 = gated(keys);
  g2.open("alpha");
  const timers = manualTimers();
  const second = await startCore({ llm: g2.llm, home: first.home, fanoutTimers: timers });
  try {
    await waitFor(() => g2.asked.includes("beta") && g2.asked.includes("gamma"), "the cut two resumed");
    assert.equal(results(second, parent).length, 0, "alpha is still held after the restart");
    assert.equal(timers.pending(), 1, "its hold is armed again");
    g2.open("beta");
    g2.open("gamma");
    await waitFor(() => results(second, parent)[0]?.state === "completed", "the combined turn");
    await pause();
    assert.equal(results(second, parent).length, 1);
    assert.deepEqual(carried(results(second, parent)[0]), ["alpha", "beta", "gamma"]);
  } finally {
    g2.openAll();
    await second.core.close();
    await second.cleanup();
  }
});
