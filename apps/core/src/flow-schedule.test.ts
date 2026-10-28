import assert from "node:assert/strict";
import { test } from "node:test";
import { methods } from "@apx/protocol";
import type { FlowGraph } from "../../../packages/protocol/src/flow-graph.ts";
import { FlowTriggerMismatch } from "./domain/flow-graphs.ts";
import { nextCron, parseCron } from "./domain/schedule.ts";
import { say, scriptedLlm, startCore } from "./engine/testkit.ts";
import type { Llm, LlmRequest } from "./providers/llm.ts";
import { tempDir, waitFor } from "./testkit/platform.ts";

type Env = Awaited<ReturnType<typeof startCore>>;
const at = (iso: string) => new Date(iso);
const tick = { id: "tick", kind: "schedule" as const, label: "Every 5 minutes", cron: "*/5 * * * *" };
const hook = { id: "start", kind: "webhook" as const, label: "Webhook" };
const save = (from: string[]) => ({
  id: "save",
  kind: "table_write" as const,
  label: "Save",
  key: "last",
  value: { kind: "event" as const, path: from },
});
const graphOf = (trigger: FlowGraph["nodes"][number], ...rest: FlowGraph["nodes"]): FlowGraph => ({
  schemaVersion: 2,
  nodes: [trigger, ...rest],
  edges: rest.map((n, i) => ({ source: i === 0 ? trigger.id : (rest[i - 1]?.id ?? ""), target: n.id })),
  layout: [],
});

/** A Flow in a new project whose published drawing is `graph`, turned on unless `on` is false. */
async function publish(env: Env, id: string, graph: FlowGraph, on = true): Promise<string> {
  const project = (await env.client.call("projects.create", { name: `Project ${id}` })).project.id;
  await env.client.call("flows.set", {
    id,
    projectId: project,
    name: id,
    enabled: false,
    predicates: [],
    tableKey: "latest",
    action: { kind: "none" },
  });
  const draft = await env.client.call("flows.draft_save", { flow: id, expectedVersion: null, graph });
  await env.client.call("flows.publish", {
    flow: id,
    expectedDraftVersion: draft.draftVersion ?? 0,
    expectedPublishedRevision: null,
  });
  if (on) await turn(env, id, true);
  return id;
}
async function turn(env: Env, id: string, enabled: boolean) {
  const flow = env.core.store.flows.get(id);
  assert.ok(flow);
  await env.client.call("flows.set", { ...flow, enabled });
}
const events = (env: Env, flow: string) => env.core.store.flows.events(flow, 100);
const ended = (env: Env, flow: string, id: string) =>
  waitFor(() => events(env, flow).find((e) => e.event_id === id && e.state !== "pending"), `run ${id} to end`);
const flowCall = (req: LlmRequest) => req.once === true;

test("a schedule ticks on the scheduler's beat: one run per time due, counted from when it was turned on", async () => {
  let now = at("2026-11-02T10:02:00Z");
  const env = await startCore({ llm: scriptedLlm(() => say("Unused")), clock: () => now });
  try {
    const flow = await publish(env, "every5", graphOf(tick, save(["scheduled_at"])));
    // The first beat after turning it on starts the count; nothing is owed from before.
    env.core.scheduler.tick();
    assert.equal(events(env, flow).length, 0);
    now = at("2026-11-02T10:04:59Z");
    env.core.scheduler.tick();
    assert.equal(events(env, flow).length, 0);
    now = at("2026-11-02T10:05:10Z");
    env.core.scheduler.tick();
    const [run] = events(env, flow);
    assert.equal(run?.event_id, "schedule:2026-11-02T10:05:00.000Z");
    assert.equal(run?.source, "schedule");
    assert.equal(run?.scheduled_at, "2026-11-02T10:05:00.000Z");
    assert.equal(run?.created_at, "2026-11-02T10:05:10.000Z");
    assert.equal((await ended(env, flow, run?.event_id ?? "")).state, "succeeded");
    // The step got the time it was due as its event.
    assert.equal(env.core.store.flows.readRows(flow, ["last"]).last, "2026-11-02T10:05:00.000Z");
    // Beats until the next time admit nothing more.
    now = at("2026-11-02T10:05:25Z");
    env.core.scheduler.tick();
    now = at("2026-11-02T10:09:59Z");
    env.core.scheduler.tick();
    assert.equal(events(env, flow).length, 1);
    now = at("2026-11-02T10:10:03Z");
    env.core.scheduler.tick();
    assert.deepEqual(
      events(env, flow).map((e) => e.scheduled_at),
      ["2026-11-02T10:10:00.000Z", "2026-11-02T10:05:00.000Z"],
    );
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("a time due is admitted once per Flow: a second tick for it is a duplicate", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("Unused")) });
  try {
    const flow = await publish(env, "dedup", graphOf(tick, save(["scheduled_at"])));
    env.core.flows.tick(at("2026-11-02T10:00:00Z"));
    env.core.flows.tick(at("2026-11-02T10:05:01Z"));
    // As if the beat were repeated from an older count (two beats racing, a clock set back).
    env.core.store.flowSchedules.advance(flow, at("2026-11-02T10:00:00Z"));
    env.core.flows.tick(at("2026-11-02T10:05:02Z"));
    assert.equal(events(env, flow).length, 1);
    const flowDef = env.core.store.flows.get(flow);
    assert.ok(flowDef);
    assert.equal(
      env.core.store.flows.receive(flow, "schedule:2026-11-02T10:05:00.000Z", {}, () => {}, new Date(), {
        source: "schedule",
      }),
      "duplicate",
    );
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("times missed while the core was off run once when it starts, not once each", async () => {
  const home = tempDir();
  let now = at("2026-11-02T10:00:30Z");
  let env = await startCore({ home: home.path, llm: scriptedLlm(() => say("Unused")), clock: () => now });
  try {
    const flow = await publish(env, "missed", graphOf(tick, save(["scheduled_at"])));
    env.core.scheduler.tick();
    await env.core.close();
    // Off for three hours: 36 times went by. Starting, the core beats once at once.
    now = at("2026-11-02T13:07:00Z");
    env = await startCore({ home: home.path, llm: scriptedLlm(() => say("Unused")), clock: () => now });
    const [late, ...rest] = events(env, flow);
    assert.equal(rest.length, 0);
    assert.equal(late?.scheduled_at, "2026-11-02T10:05:00.000Z");
    assert.equal(late?.created_at, "2026-11-02T13:07:00.000Z");
    assert.equal((await ended(env, flow, late?.event_id ?? "")).state, "succeeded");
    now = at("2026-11-02T13:09:59Z");
    env.core.scheduler.tick();
    assert.equal(events(env, flow).length, 1);
    // Then it keeps its times again.
    now = at("2026-11-02T13:10:04Z");
    env.core.scheduler.tick();
    assert.equal(events(env, flow)[0]?.scheduled_at, "2026-11-02T13:10:00.000Z");
  } finally {
    await env.core.close();
    await env.cleanup();
    await home.remove();
  }
});

test("a Flow that is off does not tick, and turned on owes nothing from while it was off", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("Unused")) });
  try {
    const flow = await publish(env, "off", graphOf(tick, save(["scheduled_at"])), false);
    env.core.flows.tick(at("2026-11-02T10:00:00Z"));
    env.core.flows.tick(at("2026-11-02T10:05:01Z"));
    assert.equal(events(env, flow).length, 0);
    assert.equal(env.core.store.flowSchedules.since(flow), undefined);
    await turn(env, flow, true);
    env.core.flows.tick(at("2026-11-02T10:06:00Z"));
    env.core.flows.tick(at("2026-11-02T10:10:01Z"));
    assert.equal(events(env, flow).length, 1);
    // Off again in the middle: its count is dropped, the 10:15 time never runs.
    await turn(env, flow, false);
    env.core.flows.tick(at("2026-11-02T10:15:01Z"));
    await turn(env, flow, true);
    env.core.flows.tick(at("2026-11-02T10:16:00Z"));
    env.core.flows.tick(at("2026-11-02T10:19:59Z"));
    assert.deepEqual(
      events(env, flow).map((e) => e.scheduled_at),
      ["2026-11-02T10:10:00.000Z"],
    );
    // A Flow that is off shows no next time.
    await turn(env, flow, false);
    const list = await env.client.call("flows.list", {});
    assert.deepEqual(list.schedules[flow], { cron: "*/5 * * * *", next_at: null });
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("schedules run in the owner's time zone", async () => {
  // 2026-11-02 is a Monday; Buenos Aires is UTC-3 all year.
  let now = at("2026-11-02T11:00:00Z");
  const env = await startCore({ llm: scriptedLlm(() => say("Unused")), clock: () => now });
  try {
    env.core.store.settings.write("owner_profile", { about: "", timezone: "America/Argentina/Buenos_Aires" });
    const weekdays = { ...tick, label: "Weekdays 08:30", cron: "30 8 * * 1-5" };
    const flow = await publish(env, "zone", graphOf(weekdays, save(["scheduled_at"])));
    const list = await env.client.call("flows.list", {});
    assert.equal(list.time_zone, "America/Argentina/Buenos_Aires");
    assert.equal(list.schedules[flow]?.next_at, "2026-11-02T11:30:00.000Z");
    const next = await env.client.call("flows.next_runs", { cron: "30 8 * * 1-5" });
    assert.deepEqual(next, {
      next: ["2026-11-02T11:30:00.000Z", "2026-11-03T11:30:00.000Z", "2026-11-04T11:30:00.000Z"],
      time_zone: "America/Argentina/Buenos_Aires",
      error: null,
    });
    env.core.scheduler.tick();
    now = at("2026-11-02T11:30:05Z");
    env.core.scheduler.tick();
    assert.equal(events(env, flow)[0]?.scheduled_at, "2026-11-02T11:30:00.000Z");
    // Friday 08:30 is followed by Monday's, not Saturday's.
    assert.equal(
      nextCron(parseCron("30 8 * * 1-5"), at("2026-11-06T11:31:00Z"), "America/Argentina/Buenos_Aires")?.toISOString(),
      "2026-11-09T11:30:00.000Z",
    );
    // Another zone, across its own date line.
    assert.equal(
      nextCron(parseCron("0 3 * * *"), at("2026-11-02T10:00:00Z"), "Asia/Tokyo")?.toISOString(),
      "2026-11-02T18:00:00.000Z",
    );
    assert.equal((await env.client.call("flows.next_runs", { cron: "* * * * *" })).error, "too_often");
    assert.equal((await env.client.call("flows.next_runs", { cron: "61 * * * *" })).error, "invalid");
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("a schedule Flow never takes a POST and a webhook Flow never ticks", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("Unused")) });
  try {
    const timed = await publish(env, "timed", graphOf(tick, save(["scheduled_at"])));
    const posted = await publish(env, "posted", graphOf(hook, save([])));
    assert.equal(env.core.flows.routes(`/flows/${timed}`), undefined);
    assert.ok(env.core.flows.routes(`/flows/${posted}`));
    assert.deepEqual(
      env.core.flows.publicEndpoints().map((e) => e.path),
      [`/flows/${posted}`],
    );
    // Even past the route, admission refuses the other way in.
    assert.throws(
      () => env.core.store.flows.receive(timed, "x", { a: 1 }, () => {}, new Date(), { source: "webhook" }),
      FlowTriggerMismatch,
    );
    assert.throws(
      () => env.core.store.flows.receive(posted, "y", { a: 1 }, () => {}, new Date(), { source: "schedule" }),
      FlowTriggerMismatch,
    );
    env.core.flows.tick(at("2026-11-02T10:00:00Z"));
    env.core.flows.tick(at("2026-11-02T12:00:00Z"));
    assert.equal(events(env, posted).length, 0);
    assert.equal(env.core.store.flowSchedules.since(posted), undefined);
    // Validation keeps a drawing to one trigger and a cron that runs at most every five minutes.
    const flow = env.core.store.flows.get(posted);
    assert.ok(flow);
    const issues = async (graph: FlowGraph) =>
      (await env.client.call("flows.validate", { project: flow.projectId, graph })).issues.map((i) => i.code);
    assert.deepEqual(await issues(graphOf(tick, save([]))), []);
    assert.deepEqual(await issues({ ...graphOf(tick, save([])), nodes: [tick, hook, save([])] }), ["trigger_count"]);
    assert.deepEqual(await issues(graphOf({ ...tick, cron: "*/2 * * * *" }, save([]))), ["schedule_too_often"]);
    assert.deepEqual(await issues(graphOf({ ...tick, cron: "every day" }, save([]))), ["schedule_invalid"]);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("Run now goes through the trigger's admission, marked as the owner's", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("Unused")) });
  try {
    assert.equal(methods["flows.run_now"].effect, true);
    assert.equal(methods["flows.run_now"].access, "human");
    const timed = await publish(env, "timed", graphOf(tick, save([])));
    const started = await env.client.call("flows.run_now", { flow: timed });
    assert.equal(started.state, "pending");
    assert.match(started.event, /^owner:/);
    const run = await ended(env, timed, started.event);
    assert.equal(run.state, "succeeded");
    assert.equal(run.source, "owner");
    assert.equal(run.scheduled_at, null);
    // A schedule Flow's run by hand has an empty event, whatever was sent.
    assert.deepEqual(env.core.store.flows.readRows(timed, ["last"]).last, {});
    const posted = await publish(env, "posted", graphOf(hook, save(["text"])));
    const sample = await env.client.call("flows.run_now", {
      flow: posted,
      data: { text: "Hello", token: "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789" },
    });
    assert.equal((await ended(env, posted, sample.event)).state, "succeeded");
    assert.equal(env.core.store.flows.readRows(posted, ["last"]).last, "Hello");
    // The sample is stored like any payload: credentials never kept.
    const kept = env.core.store.flowGraphRuns.detail(posted, sample.event)?.steps.find((s) => s.node === "start");
    assert.doesNotMatch(kept?.output ?? "", /sk-ant/);
    // The same rule as a POST: an empty body starts nothing.
    assert.equal((await env.client.call("flows.run_now", { flow: posted, data: {} })).state, "ignored");
    await turn(env, posted, false);
    await assert.rejects(env.client.call("flows.run_now", { flow: posted, data: { text: "Off" } }), /Turn the flow on/);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

/** A model that holds every call until told, after it was sent. */
function heldLlm() {
  const calls: LlmRequest[] = [];
  const aborted: unknown[] = [];
  const llm: Llm & { calls: LlmRequest[]; aborted: unknown[] } = {
    calls,
    aborted,
    label: () => "fake/fake-1",
    complete(req) {
      calls.push(req);
      if (flowCall(req)) req.onDispatch?.();
      return new Promise((_, reject) => {
        req.signal.addEventListener(
          "abort",
          () => {
            aborted.push(req.signal.reason);
            reject(req.signal.reason);
          },
          { once: true },
        );
      });
    },
  };
  return llm;
}

test("cancelling a run mid-way: pending steps are cancelled, a model call already sent is left to look at", async () => {
  const held = heldLlm();
  const env = await startCore({ llm: held });
  try {
    assert.equal(methods["flows.cancel_run"].access, "human");
    assert.equal(methods["flows.cancel_run"].effect, true);
    const think = {
      id: "think",
      kind: "llm" as const,
      label: "Think",
      model: "fake/fake-1",
      prompt: "Summarize.",
      input: { kind: "event" as const, path: [] },
      maxOutputTokens: 100,
      timeoutMs: 60_000,
    };
    const flow = await publish(env, "stop", graphOf(tick, think, save([])));
    const started = await env.client.call("flows.run_now", { flow });
    await waitFor(() => held.calls.filter(flowCall).length === 1, "the model call");
    const out = await env.client.call("flows.cancel_run", { flow, event: started.event });
    assert.deepEqual(out, { cancelled: true, state: "uncertain" });
    const detail = await env.client.call("flows.run_get", { flow, event: started.event });
    assert.equal(detail.state, "uncertain");
    const by = Object.fromEntries(detail.steps.map((s) => [s.node, [s.state, s.error]]));
    assert.deepEqual(by, {
      tick: ["succeeded", null],
      think: ["uncertain", "model_uncertain"],
      save: ["cancelled", "owner_cancelled"],
    });
    // The call in flight was stopped and never sent again.
    await waitFor(() => held.aborted.length === 1, "the call to be aborted");
    assert.equal(held.calls.filter(flowCall).length, 1);
    // Nothing more happens to an ended run.
    assert.deepEqual(await env.client.call("flows.cancel_run", { flow, event: started.event }), {
      cancelled: false,
      state: null,
    });
    assert.equal(env.core.store.flows.readRows(flow, ["last"]).last, undefined);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("cancelling a run whose next step has not started ends it cancelled", async () => {
  const held = heldLlm();
  const env = await startCore({ llm: held });
  try {
    const flow = await publish(env, "queue", graphOf(tick, save([])));
    // Off, a run admitted before stays where it is: nothing starts.
    const first = await env.client.call("flows.run_now", { flow });
    await ended(env, flow, first.event);
    const flowDef = env.core.store.flows.get(flow);
    assert.ok(flowDef);
    const state = env.core.store.flows.receive(flow, "owner:held", {}, () => {}, new Date(), { source: "owner" });
    assert.equal(state, "pending");
    await turn(env, flow, false);
    assert.deepEqual(await env.client.call("flows.cancel_run", { flow, event: "owner:held" }), {
      cancelled: true,
      state: "cancelled",
    });
    const detail = await env.client.call("flows.run_get", { flow, event: "owner:held" });
    assert.deepEqual(
      detail.steps.map((s) => s.state),
      detail.steps.map((s) => (s.state === "succeeded" ? "succeeded" : "cancelled")),
    );
    assert.ok(detail.steps.some((s) => s.error === "owner_cancelled"));
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("Try a run follows a branched drawing without doing any of its work", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("Unused")) });
  try {
    const check = {
      id: "is-order",
      kind: "condition" as const,
      label: "Order?",
      input: { kind: "event" as const, path: ["type"] },
      equals: "order",
    };
    const graph: FlowGraph = {
      schemaVersion: 2,
      nodes: [hook, check, { ...save(["text"]), id: "yes" }, { ...save(["missing"]), id: "no", key: "other" }],
      edges: [
        { source: "start", target: "is-order" },
        { source: "is-order", target: "yes", when: "yes" },
        { source: "is-order", target: "no", when: "no" },
      ],
      layout: [],
    };
    const order = await env.client.call("flows.try_graph", { graph, data: { type: "order", text: "Hi" } });
    assert.deepEqual(
      order.steps.map((s) => [s.node, s.state, s.matched]),
      [
        ["start", "ran", null],
        ["is-order", "ran", true],
        ["yes", "would_run", null],
        ["no", "skipped", null],
      ],
    );
    const refund = await env.client.call("flows.try_graph", { graph, data: { type: "refund" } });
    assert.deepEqual(
      refund.steps.map((s) => [s.node, s.state]),
      [
        ["start", "ran"],
        ["is-order", "ran"],
        ["yes", "skipped"],
        ["no", "missing"],
      ],
    );
    assert.equal(env.core.store.flows.list().length, 0);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
