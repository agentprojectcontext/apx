// A Flow's two triggers as the owner sets them in the editor (DECISIONS.md#d-182): a schedule with different times
// on different days, a webhook that takes GET as well as POST, and the key its callers send, made or chosen.
import assert from "node:assert/strict";
import { test } from "node:test";
import { switchTrigger } from "../../../packages/protocol/src/flow-edit.ts";
import type { FlowGraph } from "../../../packages/protocol/src/flow-graph.ts";
import { flowCronProblem, nextCrons, parseCrons } from "./domain/schedule.ts";
import { say, scriptedLlm, startCore } from "./engine/testkit.ts";

type Env = Awaited<ReturnType<typeof startCore>>;
const save = {
  id: "save",
  kind: "table_write" as const,
  label: "Save",
  key: "last",
  value: { kind: "event" as const, path: [] },
};
const graphOf = (trigger: FlowGraph["nodes"][number]): FlowGraph => ({
  schemaVersion: 2,
  nodes: [trigger, save],
  edges: [{ source: trigger.id, target: save.id }],
  layout: [],
});

async function published(env: Env, name: string, graph: FlowGraph) {
  const project = (await env.client.call("projects.create", { name: `Project ${name}` })).project.id;
  const m = await env.client.call("flows.create", { project, name, graph });
  await env.client.call("flows.publish", {
    flow: m.flow.id,
    expectedDraftVersion: m.document.draftVersion ?? 0,
    expectedPublishedRevision: null,
  });
  return env.client.call("flows.set", { ...m.flow, enabled: true });
}

test("a schedule holds several crons: each day its own times, the first one due wins", () => {
  // Monday at 04:00 and 06:30, Wednesday at 09:15.
  const crons = parseCrons("0 4 * * 1; 30 6 * * 1;15 9 * * 3");
  assert.equal(crons.length, 3);
  const monday = new Date("2026-11-02T00:00:00Z");
  const times: string[] = [];
  for (let at = monday, i = 0; i < 4; i++) {
    const next = nextCrons(crons, at, "UTC");
    assert.ok(next);
    times.push(next.toISOString());
    at = next;
  }
  assert.deepEqual(times, [
    "2026-11-02T04:00:00.000Z",
    "2026-11-02T06:30:00.000Z",
    "2026-11-04T09:15:00.000Z",
    "2026-11-09T04:00:00.000Z",
  ]);
  assert.equal(flowCronProblem("0 4 * * 1; 30 6 * * 1"), undefined);
  // Each part must be a cron, there are at most seven, and together they keep the five-minute gap.
  assert.equal(flowCronProblem("0 4 * * 1; every day"), "invalid");
  assert.equal(flowCronProblem("0 4 * * 1;"), "invalid");
  assert.equal(flowCronProblem(Array.from({ length: 8 }, (_, i) => `0 ${i} * * *`).join("; ")), "invalid");
  assert.equal(flowCronProblem("0 4 * * 1; 2 4 * * 1"), "too_often");
});

test("next runs and validation read a schedule of several crons", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("Unused")) });
  try {
    const r = await env.client.call("flows.next_runs", { cron: "0 4 * * 1; 0 5 * * 2" });
    assert.equal(r.error, null);
    assert.equal(r.next.length, 3);
    const project = (await env.client.call("projects.create", { name: "Checks" })).project.id;
    const tick = { id: "tick", kind: "schedule" as const, label: "Times", cron: "0 4 * * 1; 0 5 * * 2" };
    const issues = async (graph: FlowGraph) =>
      (await env.client.call("flows.validate", { project, graph })).issues.map((i) => i.code);
    assert.deepEqual(await issues(graphOf(tick)), []);
    assert.deepEqual(await issues(graphOf({ ...tick, cron: "0 4 * * 1; 1 4 * * 1" })), ["schedule_too_often"]);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("a trigger switches kind under the same id; any other step stays as it is", () => {
  const hook = { id: "start", kind: "webhook" as const, label: "Start", methods: ["GET" as const] };
  const timed = switchTrigger(hook);
  assert.deepEqual(timed, { id: "start", kind: "schedule", label: "Start", cron: "30 8 * * 1-5" });
  assert.deepEqual(switchTrigger(timed, "Webhook"), { id: "start", kind: "webhook", label: "Webhook" });
  assert.deepEqual(switchTrigger(save), save);
});

test("a webhook answers the methods its step names, GET reading the query, both with its key", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("Unused")) });
  try {
    const both = await published(
      env,
      "Both",
      graphOf({ id: "start", kind: "webhook", label: "Start", methods: ["POST", "GET"] }),
    );
    const plain = await published(env, "Plain", graphOf({ id: "start", kind: "webhook", label: "Start" }));
    const key = await env.client.call("flows.token_rotate", { flow: both.id });
    assert.match(key.token ?? "", /^apxp_[a-f0-9]{64}$/);
    await env.client.call("flows.token_rotate", { flow: plain.id });
    const auth = { authorization: `Bearer ${key.token}` };
    const { port } = await env.client.call("webhooks.get", {});
    assert.ok(port);
    const url = (path: string) => `http://127.0.0.1:${port}${path}`;
    const got = await fetch(url("/flows/both?id=ev-1&name=Ada%20L&tag=a&tag=b"), { headers: auth });
    assert.equal(got.status, 202);
    const event = env.core.store.flows.events(both.id, 10).find((e) => e.event_id === "ev-1");
    assert.ok(event);
    // The query is the data, `id` aside; a repeated name is a list.
    assert.deepEqual(env.core.store.flows.rowsPage(both.id, 10).rows[0]?.value, { name: "Ada L", tag: ["a", "b"] });
    // Without a key, a GET is refused like a POST.
    assert.equal((await fetch(url("/flows/both?id=ev-2"))).status, 401);
    const posted = await fetch(url("/flows/both"), {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ id: "ev-3", data: { n: 1 } }),
    });
    assert.equal(posted.status, 202);
    // A webhook that names no method takes POST only.
    const refused = await fetch(url(`/flows/${plain.path}?id=x`), { headers: auth });
    assert.equal(refused.status, 405);
    assert.equal(refused.headers.get("allow"), "POST");
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("the owner sees, chooses and rotates a webhook's key; the old one stops at once", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("Unused")) });
  try {
    const flow = await published(env, "Keyed", graphOf({ id: "start", kind: "webhook", label: "Start" }));
    assert.deepEqual(await env.client.call("flows.token", { flow: flow.id }), { token: null, rotated_at: null });
    const mine = "my-own-service-key-0123456789";
    const chosen = await env.client.call("flows.token_rotate", { flow: flow.id, token: mine });
    assert.equal(chosen.token, mine);
    assert.equal((await env.client.call("flows.token", { flow: flow.id })).token, mine);
    await assert.rejects(env.client.call("flows.token_rotate", { flow: flow.id, token: "short" }));
    const { port } = await env.client.call("webhooks.get", {});
    assert.ok(port);
    const send = (token: string) =>
      fetch(`http://127.0.0.1:${port}/flows/${flow.path}`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ id: token.slice(0, 8), data: { n: 1 } }),
      });
    assert.equal((await send(mine)).status, 202);
    const rotated = await env.client.call("flows.token_rotate", { flow: flow.id });
    assert.ok(rotated.token && rotated.token !== mine);
    assert.equal((await send(mine)).status, 401);
    assert.equal((await send(rotated.token)).status, 202);
    // A schedule Flow has no address, so nothing to key.
    const timed = await published(
      env,
      "Timed",
      graphOf({ id: "tick", kind: "schedule", label: "Tick", cron: "0 3 * * *" }),
    );
    await assert.rejects(env.client.call("flows.token_rotate", { flow: timed.id }), /no address/);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
