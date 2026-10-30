import assert from "node:assert/strict";
import { after, beforeEach, type TestContext, test } from "node:test";
import { methods, Run, Thread } from "@apx/protocol";
import { data } from "./state.ts";

const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: { location: { origin: "http://panel.example.test" } },
});
const { continueDelegation, delegationState, latestDelegatedRun, refreshDelegation } = await import("./delegation.ts");
after(() => {
  if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
  else Reflect.deleteProperty(globalThis, "window");
});
const initial = data.get();
beforeEach(() => data.set(initial));
const at = "2026-01-01T00:00:00Z";
const thread = (state = "idle") =>
  Thread.parse({
    id: "sub",
    kind: "a2a",
    title: "Review",
    parent_id: "root",
    agent_ids: ["superagent"],
    state,
    created_at: at,
    updated_at: at,
  });
const run = (id = "old", state = "completed", end_reason = "step_limit", started_at = at) =>
  Run.parse({ id, thread_id: "sub", agent_id: "superagent", state, end_reason, started_at });
function rpc(t: TestContext, answer: () => Promise<unknown>) {
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    const method = url.split("/").at(-1) ?? "";
    assert.ok(method === "threads.get" || method === "threads.send");
    methods[method].params.parse(JSON.parse(String(init.body)));
    return Response.json({ ok: true, result: await answer() });
  });
}

test("a historical limit follows the current run, including completion and pending owner input", () => {
  assert.equal(delegationState(thread("working"), run()), "working");
  assert.equal(delegationState(thread("queued"), run()), "queued");
  assert.equal(delegationState(thread("input-required"), run()), "waiting");
  assert.equal(delegationState(thread(), run()), "stopped");
  assert.equal(delegationState(thread(), run("new", "completed", "normal")), "completed");
  assert.equal(delegationState(undefined, run()), "loading");
  const newer = run("new", "working", "normal", "2026-01-02T00:00:00Z");
  assert.equal(latestDelegatedRun({ old: run(), new: newer }, "sub"), newer);
});

test("concurrent reads deduplicate and a late snapshot never replaces newer thread or run events", async (t) => {
  const pending = Promise.withResolvers<unknown>();
  rpc(t, () => pending.promise);
  const read = refreshDelegation("sub");
  assert.equal(refreshDelegation("sub"), read);
  const liveThread = thread("working");
  const liveRun = run("old", "working");
  data.set({ threads: { sub: liveThread }, runs: { old: liveRun } });
  pending.resolve({ thread: thread(), messages: [], runs: [run()] });
  await read;
  assert.equal(data.get().threads.sub, liveThread);
  assert.equal(data.get().runs.old, liveRun);
});

test("failed status reads can be retried; continuation acknowledgements cannot undo a newer completion", async (t) => {
  rpc(t, async () => {
    throw new Error("Offline");
  });
  await assert.rejects(refreshDelegation("sub"), /Offline/);
  const latest = run("new", "completed", "normal");
  let calls = 0;
  rpc(t, async () => {
    if (++calls === 1) {
      data.set({ threads: { sub: thread() }, runs: { new: latest } });
      return { message: {}, run: run("new", "submitted") };
    }
    return { thread: thread(), messages: [], runs: [latest] };
  });
  await continueDelegation("sub", "old");
  assert.equal(data.get().runs.new?.state, "completed");
  assert.equal(data.get().threads.sub?.state, "idle");
});

test("visible notices revalidate after gaps and force a fresh read past an older pending request", async (t) => {
  const { observeDelegation, refetchDelegations } = await import("./delegation.ts");
  const old = Promise.withResolvers<unknown>();
  let calls = 0;
  rpc(t, async () =>
    ++calls === 1
      ? old.promise
      : { thread: thread("working"), runs: [run("new", "working", "normal", "2026-01-02T00:00:00Z")], messages: [] },
  );
  const stopA = observeDelegation("sub");
  const stopB = observeDelegation("sub");
  try {
    const stale = refreshDelegation("sub");
    await refetchDelegations();
    assert.equal(data.get().threads.sub?.state, "working");
    old.resolve({ thread: thread(), runs: [run()], messages: [] });
    await stale;
    assert.equal(data.get().threads.sub?.state, "working");
    assert.equal(latestDelegatedRun(data.get().runs, "sub")?.id, "new");
    stopA();
    await refetchDelegations();
    assert.equal(calls, 3);
  } finally {
    stopB();
  }
  await refetchDelegations();
  assert.equal(calls, 3);
});

test("a superseded read cannot invalidate a newer refresh when it resolves first", async (t) => {
  const old = Promise.withResolvers<unknown>();
  const fresh = Promise.withResolvers<unknown>();
  let calls = 0;
  rpc(t, () => (++calls === 1 ? old.promise : fresh.promise));
  const first = refreshDelegation("sub");
  const second = refreshDelegation("sub", true);
  old.resolve({ thread: thread(), runs: [run()], messages: [] });
  await first;
  fresh.resolve({ thread: thread("working"), runs: [run("new", "working")], messages: [] });
  await second;
  assert.equal(data.get().threads.sub?.state, "working");
  assert.equal(data.get().runs.new?.state, "working");
});

test("a deleted session cannot fail the panel's reconnect refresh", async (t) => {
  const { observeDelegation, refetchDelegations } = await import("./delegation.ts");
  rpc(t, async () => {
    throw new Error("Session not found");
  });
  const stop = observeDelegation("missing");
  try {
    await assert.doesNotReject(refetchDelegations());
    assert.equal(data.get().threads.missing, undefined);
  } finally {
    stop();
  }
});
