// A Flow's own address and the owner's tests with a real event (DECISIONS.md#d-178), through the protocol and the
// public listener as a caller reaches them.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { CoreEvent } from "@apx/protocol";
import type { FlowGraph } from "../../../packages/protocol/src/flow-graph.ts";
import { say, scriptedLlm, startCore } from "./engine/testkit.ts";
import { FLOW_TEST_MS } from "./flow-tests.ts";
import { manualTimers, waitFor } from "./testkit/platform.ts";

type Env = Awaited<ReturnType<typeof startCore>>;
const hook = { id: "start", kind: "webhook" as const, label: "Webhook" };
const tick = { id: "tick", kind: "schedule" as const, label: "Every hour", cron: "0 * * * *" };
const save = {
  id: "save",
  kind: "table_write" as const,
  label: "Save",
  table: "leads",
  key: "last",
  value: { kind: "event" as const, path: [] },
};
const graphOf = (trigger: FlowGraph["nodes"][number], ...rest: FlowGraph["nodes"]): FlowGraph => ({
  schemaVersion: 2,
  nodes: [trigger, ...rest],
  edges: rest.map((n, i) => ({ source: i === 0 ? trigger.id : (rest[i - 1]?.id ?? ""), target: n.id })),
  layout: [],
});

/** A new Flow made the way the panel makes one, off, with this drawing as its draft. */
async function made(env: Env, name: string, graph: FlowGraph, path?: string) {
  const project = (await env.client.call("projects.create", { name: `Project ${name}` })).project.id;
  await env.client.call("tables.create", { project, name: "leads" });
  return env.client.call("flows.create", { project, name, graph, ...(path ? { path } : {}) });
}
const post = (port: number, path: string, data: unknown, headers: Record<string, string> = {}) =>
  fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ id: "one", data }),
  });
const heard = (env: Env) => {
  const seen: CoreEvent[] = [];
  env.core.bus.on((e) => {
    if (e.type === "flow.test" || e.type === "flow.run") seen.push(e);
  });
  return seen;
};

test("a Flow's address comes from its name, stays unique, and an old Flow keeps its identifier", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("Unused")) });
  try {
    const one = await made(env, "Leads from the form", graphOf(hook, save));
    assert.equal(one.flow.path, "leads-from-the-form");
    assert.notEqual(one.flow.id, one.flow.path);
    const two = await made(env, "Leads from the form", graphOf(hook, save));
    assert.equal(two.flow.path, "leads-from-the-form-2");
    // The owner's own choice is checked: another Flow's address, one that isn't an address, or `test`.
    assert.deepEqual(await env.client.call("flows.path_check", { path: "leads-from-the-form" }), {
      ok: false,
      problem: "taken",
      free: "leads-from-the-form-3",
    });
    assert.equal((await env.client.call("flows.path_check", { path: "Not A Path" })).problem, "invalid");
    assert.equal((await env.client.call("flows.path_check", { path: "test" })).problem, "reserved");
    assert.equal(
      (await env.client.call("flows.path_check", { path: "leads-from-the-form", flow: one.flow.id })).ok,
      true,
    );
    await assert.rejects(
      env.client.call("flows.path_set", { flow: two.flow.id, path: "leads-from-the-form" }),
      /Another flow uses this address/,
    );
    await assert.rejects(made(env, "Other", graphOf(hook, save), "leads-from-the-form"), /Another flow/);
    const chosen = await made(env, "Chosen", graphOf(hook, save), "my-address");
    assert.equal(chosen.flow.path, "my-address");
    // Saving a Flow without its path keeps the one it has.
    const kept = await env.client.call("flows.set", { ...chosen.flow, path: undefined, name: "Renamed" });
    assert.equal(kept.path, "my-address");
    // Only flows.path_set changes an address, the way that says the old one stops.
    await assert.rejects(env.client.call("flows.set", { ...kept, path: "elsewhere" }), /flows.path_set/);
    assert.equal(env.core.store.flows.get(kept.id)?.path, "my-address");
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("production answers at the Flow's path; a rename moves its key and the old address stops", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("Unused")) });
  try {
    const m = await made(env, "Orders", graphOf(hook, save));
    await env.client.call("flows.publish", {
      flow: m.flow.id,
      expectedDraftVersion: m.document.draftVersion ?? 0,
      expectedPublishedRevision: null,
    });
    await env.client.call("flows.set", { ...m.flow, enabled: true });
    const credential = await env.client.call("public_routes.rotate", { path: "/flows/orders" });
    const auth = { authorization: `Bearer ${env.core.secrets.resolve(credential.secret_ref)}` };
    const { port } = await env.client.call("webhooks.get", {});
    assert.ok(port);
    assert.equal((await post(port, "/flows/orders", { n: 1 }, auth)).status, 202);
    // The identifier is not an address.
    assert.equal((await post(port, `/flows/${m.flow.id}`, { n: 1 }, auth)).status, 404);
    const renamed = await env.client.call("flows.path_set", { flow: m.flow.id, path: "new-orders" });
    assert.equal(renamed.path, "new-orders");
    assert.equal((await post(port, "/flows/orders", { n: 2 }, auth)).status, 404);
    const moved = await post(port, "/flows/new-orders", { n: 2 }, auth);
    assert.equal(moved.status, 202);
    const { routes } = await env.client.call("public_routes.list", {});
    assert.deepEqual(
      routes.map((r) => [r.path, r.enabled]),
      [["/flows/new-orders", true]],
    );
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("the test address runs nothing unless the owner listens: one event, the saved drawing, marked as a test", async () => {
  const timers = manualTimers();
  const env = await startCore({ llm: scriptedLlm(() => say("Unused")), runTimers: timers });
  const seen = heard(env);
  try {
    const m = await made(env, "Leads", graphOf(hook, save));
    const { port } = await env.client.call("webhooks.get", {});
    assert.ok(port);
    // Not listening: the same plain answer whether or not a Flow has that path, and nothing is admitted.
    for (const path of ["/flows/test/leads", "/flows/test/nobody"]) {
      const r = await post(port, path, { name: "Ada" });
      assert.equal(r.status, 404);
    }
    assert.equal(env.core.store.flows.events(m.flow.id, 10).length, 0);
    assert.equal(timers.pending(), 0);
    const started = await env.client.call("flows.test_start", {
      flow: m.flow.id,
      expectedDraftVersion: m.document.draftVersion,
    });
    assert.equal(started.listening?.path, "/flows/test/leads");
    assert.equal(Date.parse(started.listening?.until ?? "") - timers.now(), FLOW_TEST_MS);
    // The same checks as the Flow's own address: the body's shape first, which leaves the test waiting.
    assert.equal((await fetch(`http://127.0.0.1:${port}/flows/test/leads`, { method: "GET" })).status, 405);
    const bad = await fetch(`http://127.0.0.1:${port}/flows/test/leads`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "no envelope" }),
    });
    assert.equal(bad.status, 400);
    const first = await post(port, "/flows/test/leads", { name: "Ada" }, { "user-agent": "Northwind forms" });
    assert.equal(first.status, 202);
    // One event only.
    assert.equal((await post(port, "/flows/test/leads", { name: "Grace" })).status, 404);
    const [run] = env.core.store.flows.events(m.flow.id, 10);
    assert.ok(run?.test);
    assert.ok(run.event_id.startsWith("test:"));
    // It ran though the Flow is off and nothing is published.
    const ended = await waitFor(
      () => env.core.store.flows.events(m.flow.id, 10).find((e) => e.state !== "pending"),
      "the test run to end",
    );
    assert.equal(ended.state, "succeeded");
    assert.equal(env.core.store.flowGraphs.get(m.flow.id).publishedRevision, null);
    const detail = await env.client.call("flows.run_get", { flow: m.flow.id, event: run.event_id });
    assert.equal(detail.test, true);
    assert.deepEqual(detail.arrived?.headers, {
      "content-type": "application/json",
      "content-length": String(JSON.stringify({ id: "one", data: { name: "Ada" } }).length),
      "user-agent": "Northwind forms",
    });
    assert.equal(detail.arrived?.body, JSON.stringify({ name: "Ada" }));
    const rows = await env.client.call("tables.get", { project: m.flow.projectId, table: "leads", limit: 5 });
    assert.deepEqual(rows.rows[0]?.value, { name: "Ada" });
    // The editor heard it start, the event come, and each step move.
    const kinds = seen.map((e) =>
      e.type === "flow.test" ? e.state : e.type === "flow.run" ? `run:${e.state}` : e.type,
    );
    assert.deepEqual(kinds.slice(0, 2), ["listening", "received"]);
    assert.ok(kinds.includes("run:succeeded"));
    const last = seen.findLast((e) => e.type === "flow.run");
    assert.deepEqual(last?.type === "flow.run" ? last.steps : [], [
      { node: "start", state: "succeeded" },
      { node: "save", state: "succeeded" },
    ]);
    assert.equal(timers.pending(), 0);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("a test stops waiting after five minutes or when stopped; the address's key is asked when it has one", async () => {
  const timers = manualTimers();
  const env = await startCore({ llm: scriptedLlm(() => say("Unused")), runTimers: timers });
  const seen = heard(env);
  try {
    const m = await made(env, "Signups", graphOf(hook, save));
    const { port } = await env.client.call("webhooks.get", {});
    assert.ok(port);
    const start = () =>
      env.client.call("flows.test_start", { flow: m.flow.id, expectedDraftVersion: m.document.draftVersion });
    await start();
    timers.tick(FLOW_TEST_MS - 1);
    assert.equal(env.core.flows.tests.until(m.flow.id)?.getTime(), timers.now() + 1);
    timers.tick(1);
    assert.equal(env.core.flows.tests.until(m.flow.id), undefined);
    assert.equal(timers.pending(), 0);
    assert.equal((await post(port, "/flows/test/signups", { a: 1 })).status, 404);
    await start();
    assert.deepEqual(await env.client.call("flows.test_stop", { flow: m.flow.id }), { stopped: true });
    assert.equal((await post(port, "/flows/test/signups", { a: 1 })).status, 404);
    assert.deepEqual(
      seen.flatMap((e) => (e.type === "flow.test" ? [e.state] : [])),
      ["listening", "expired", "listening", "stopped"],
    );
    assert.equal(env.core.store.flows.events(m.flow.id, 10).length, 0);
    // Once its address has a key, the test asks for it too, as the address does; it still waits after a refusal.
    await env.client.call("flows.publish", {
      flow: m.flow.id,
      expectedDraftVersion: m.document.draftVersion ?? 0,
      expectedPublishedRevision: null,
    });
    await env.client.call("flows.set", { ...m.flow, enabled: true });
    const credential = await env.client.call("public_routes.rotate", { path: "/flows/signups" });
    const doc = await env.client.call("flows.graph_get", { flow: m.flow.id });
    await env.client.call("flows.test_start", { flow: m.flow.id, expectedDraftVersion: doc.draftVersion });
    assert.equal((await post(port, "/flows/test/signups", { a: 1 })).status, 401);
    const auth = { authorization: `Bearer ${env.core.secrets.resolve(credential.secret_ref)}` };
    assert.equal((await post(port, "/flows/test/signups", { a: 1 }, auth)).status, 202);
    const [run] = env.core.store.flows.events(m.flow.id, 10);
    assert.equal(run?.test, true);
    // The key is never kept with what arrived.
    const detail = await env.client.call("flows.run_get", { flow: m.flow.id, event: run?.event_id ?? "" });
    assert.equal(Object.keys(detail.arrived?.headers ?? {}).includes("authorization"), false);
    // A key that can't be read now still keeps the test address shut, as it keeps the address.
    env.core.secrets.set(credential.secret_ref.slice(9), null);
    const again = await env.client.call("flows.graph_get", { flow: m.flow.id });
    await env.client.call("flows.test_start", { flow: m.flow.id, expectedDraftVersion: again.draftVersion });
    assert.equal((await post(port, "/flows/test/signups", { a: 2 })).status, 401);
    assert.equal((await post(port, "/flows/test/signups", { a: 2 }, auth)).status, 401);
    // Renamed while waiting: the old test address is gone, the new one waits.
    await env.client.call("flows.path_set", { flow: m.flow.id, path: "signups-new" });
    await env.client.call("public_routes.revoke", { path: "/flows/signups-new" });
    assert.equal((await post(port, "/flows/test/signups", { a: 3 })).status, 404);
    assert.equal((await post(port, "/flows/test/signups-new", { a: 3 })).status, 202);
    // A test's pinned number never runs another drawing.
    assert.throws(
      () =>
        env.core.store.flowGraphs.admitTest(
          m.flow.id,
          "test:other",
          { a: 4 },
          new Date(),
          { revision: detail.revision, graph: "{}" },
          () => {},
          { source: "webhook" },
        ),
      /gone/,
    );
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("a test needs the owner's OK for what it sends, the draft it was shown, and complete steps", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("Unused")) });
  try {
    const call = {
      id: "call",
      kind: "http" as const,
      label: "Call",
      method: "POST" as const,
      url: "https://api.example.com/leads",
      headers: [],
      body: "{}",
      timeoutMs: 10_000,
    };
    const m = await made(env, "Outward", graphOf(hook, call));
    const start = (outward?: string[]) =>
      env.client.call("flows.test_start", {
        flow: m.flow.id,
        expectedDraftVersion: m.document.draftVersion,
        ...(outward ? { outward } : {}),
      });
    await assert.rejects(start(), /Confirm what it sends/);
    const { keys } = await env.client.call("flows.outward", { flow: m.flow.id, graph: graphOf(hook, call) });
    assert.ok((await start(keys)).listening);
    await assert.rejects(
      env.client.call("flows.test_start", { flow: m.flow.id, expectedDraftVersion: 99, outward: keys }),
      /changed/,
    );
    const empty = await made(env, "Unfinished", graphOf(hook, { ...save, key: "" }));
    await assert.rejects(
      env.client.call("flows.test_start", { flow: empty.flow.id, expectedDraftVersion: empty.document.draftVersion }),
      (e: { detail?: { issues?: { code: string }[] } }) => e.detail?.issues?.[0]?.code === "step_incomplete",
    );
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("a schedule Flow's test runs once now, off and unpublished, and is listed as a test", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("Unused")) });
  try {
    const m = await made(env, "Hourly", graphOf(tick, save));
    const r = await env.client.call("flows.test_start", {
      flow: m.flow.id,
      expectedDraftVersion: m.document.draftVersion,
    });
    assert.equal(r.listening, null);
    assert.ok(r.event?.startsWith("test:"));
    const run = await waitFor(
      () => env.core.store.flows.events(m.flow.id, 10).find((e) => e.event_id === r.event && e.state !== "pending"),
      "the test run to end",
    );
    assert.equal(run.state, "succeeded");
    assert.equal(run.test, true);
    assert.equal(run.source, "owner");
    assert.equal(env.core.store.flowGraphs.get(m.flow.id).publishedRevision, null);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
