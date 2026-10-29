import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { CoreEvent } from "@apx/protocol";
import { ApxClient } from "@apx/protocol/client";
import type { FlowGraph } from "../../../../packages/protocol/src/flow-graph.ts";
import { createLog } from "../log.ts";
import { flowTools } from "./flow-tool.ts";
import { settingsCore } from "./settings.test-support.ts";

let h: Awaited<ReturnType<typeof settingsCore>>;
let acme = "";
let northwind = "";
const events: Extract<CoreEvent, { type: "flow.draft" }>[] = [];
before(async () => {
  h = await settingsCore({ tool: "apx_flow" });
  acme = (await h.env.client.call("projects.create", { name: "Acme" })).project.id;
  northwind = (await h.env.client.call("projects.create", { name: "Northwind" })).project.id;
  // The table the drawings here save to: a step names a table that exists (DECISIONS.md#d-176).
  await h.env.client.call("tables.create", { project: acme, name: "leads" });
  await h.env.client.call("agents.create", { project_id: acme, slug: "acme-writer", name: "Acme Writer" });
  h.env.core.bus.on((e) => {
    if (e.type === "flow.draft") events.push(e);
  });
});
after(async () => {
  await h.env.core.close();
  await h.env.cleanup();
});

const leads = () => ({
  method: "flows.create",
  params: {
    project: acme,
    name: "New leads",
    edits: [
      { op: "add", step: { kind: "webhook", id: "hook", label: "New lead" } },
      {
        op: "add",
        after: "hook",
        step: {
          kind: "table_write",
          id: "save",
          table: "leads",
          key: "$trigger.email",
          value: { kind: "event", path: [] },
        },
      },
    ],
  },
});

/** The Flow the last answer names, by its id. */
const madeId = (answer: string) => /flow ([a-z0-9-]+),/.exec(answer)?.[1] ?? "";
const doc = (flow: string) => h.env.client.call("flows.graph_get", { flow });

test("the super-agent makes a Flow, off, with a tidy draft, without asking, and the chat shows it", async () => {
  const before = events.length;
  const { answer, thread } = await h.ask(leads());
  assert.match(answer, /^Made "New leads" \(flow new-leads-[a-z0-9]+, the project Acme\), draftVersion 1\./);
  assert.match(answer, /It can run as drawn/);
  const id = madeId(answer);
  const flow = (await h.env.client.call("flows.list", {})).flows.find((f) => f.id === id);
  assert.equal(flow?.enabled, false);
  assert.equal(flow?.projectId, acme);
  const d = await doc(id);
  assert.equal(d.publishedRevision, null);
  assert.deepEqual(
    d.draft?.layout.map((p) => [p.node, p.x, p.y]),
    [
      ["hook", 0, 0],
      ["save", 280, 0],
    ],
  );
  // No card waited for the owner, and the answer carries the Flow's card.
  assert.deepEqual((await h.env.client.call("runs.pending", { thread })).inputs, []);
  const parts = (await h.env.client.call("threads.get", { thread })).messages.flatMap((m) => m.parts);
  assert.deepEqual(
    parts.filter((p) => p.type === "flow"),
    [{ type: "flow", flow: id, project: acme, name: "New leads" }],
  );
  // An open editor hears of it.
  assert.deepEqual(
    events.slice(before).map((e) => [e.flow, e.project, e.draft_version, e.by]),
    [[id, acme, 1, "roby"]],
  );
});

test("a step the agent adds without its settings waits in the draft, named as what to finish", async () => {
  const id = madeId((await h.ask(leads())).answer);
  const answer = (
    await h.ask({
      method: "flows.draft_save",
      params: {
        flow: id,
        edits: [
          { op: "add", after: "save", step: { kind: "cmd", id: "run", label: "Run it" } },
          { op: "add", after: "run", step: { kind: "notify", id: "tell", label: "Tell me", text: "Done" } },
        ],
      },
    })
  ).answer;
  assert.match(answer, /^Saved the draft of .*draftVersion 2\./);
  assert.match(
    answer,
    /- step "run" \(Run it\): Step "Run it" needs its command before it can run \[step_incomplete\]/,
  );
  assert.match(
    answer,
    /- step "tell" \(Tell me\): Step "Tell me" needs its channel before it can run \[step_incomplete\]/,
  );
  const saved = (await doc(id)).draft as FlowGraph;
  assert.deepEqual(
    saved.nodes.find((n) => n.id === "run"),
    {
      id: "run",
      label: "Run it",
      kind: "cmd",
      command: "",
      env: [],
      stdin: "",
      timeoutMs: 30000,
      continueOnError: false,
    },
  );
  // Validate reads the saved draft and says the same.
  assert.match((await h.ask({ method: "flows.validate", params: { flow: id } })).answer, /needs its command/);
});

test("edits change the latest draft, place new steps beside theirs and say why it can't run", async () => {
  const id = madeId((await h.ask(leads())).answer);
  const edit = (edits: object[]) => h.ask({ method: "flows.draft_save", params: { flow: id, edits } });
  const added = (
    await edit([
      {
        op: "add",
        after: "save",
        step: { kind: "agent", id: "think", label: "Think", agent: "nobody", prompt: "Sum up" },
      },
    ])
  ).answer;
  assert.match(added, /draftVersion 2/);
  assert.match(added, /It can't run yet:\n- step "think" \(Think\): .*\[binding_unavailable\]/);
  const g = (await doc(id)).draft as FlowGraph;
  assert.deepEqual(g.layout.at(-1), { node: "think", x: 560, y: 0 });
  assert.deepEqual(g.edges.at(-1), { source: "save", target: "think" });

  assert.match((await edit([{ op: "connect", from: "think", to: "hook" }])).answer, /nothing leads into a trigger/);
  assert.match((await edit([{ op: "connect", from: "think", to: "save" }])).answer, /it would make a loop/);
  assert.match(
    (await edit([{ op: "remove", step: "ghost" }])).answer,
    /no step "ghost"; the steps are hook, save, think/,
  );
  // An empty setting is kept in the draft and named as what keeps it from running (DECISIONS.md#d-177).
  assert.match(
    (await edit([{ op: "update", step: "save", set: { key: "" } }])).answer,
    /draftVersion 3\.[\s\S]*It can't run yet:\n- step "save" \(Save[^)]*\): .*key.*\[step_incomplete\]/,
  );
  assert.equal(((await doc(id)).draft as FlowGraph).nodes.find((n) => n.id === "save")?.kind, "table_write");
  // A shape that is not a step's is still refused.
  assert.match(
    (await edit([{ op: "update", step: "save", set: { key: 7 } }])).answer,
    /not saved: the drawing is not valid:\n- step "save" \(table_write\): key: /,
  );
  const fixed = (
    await edit([
      { op: "update", step: "save", set: { key: "$trigger.email" } },
      { op: "update", step: "think", set: { agent: "roby" } },
      { op: "disconnect", from: "save", to: "think" },
      { op: "connect", from: "hook", to: "think" },
      { op: "tidy" },
    ])
  ).answer;
  assert.match(fixed, /draftVersion 4\.[\s\S]*It can run as drawn/);
  const tidy = (await doc(id)).draft as FlowGraph;
  assert.deepEqual(
    tidy.layout.map((p) => [p.node, p.x, p.y]),
    [
      ["hook", 0, 0],
      ["save", 280, -80],
      ["think", 280, 80],
    ],
  );
  // A failed edit saved nothing: four saves, four versions.
  assert.equal((await doc(id)).draftVersion, 4);
});

test("a whole drawing needs the version it was read at, so the owner's newer save is never overwritten", async () => {
  const id = madeId((await h.ask(leads())).answer);
  const read = JSON.parse((await h.ask({ method: "flows.graph_get", params: { flow: id } })).answer);
  assert.equal(read.draftVersion, 1);
  assert.equal(read.showing, "draft");
  assert.equal(read.graph.nodes.length, 2);
  assert.equal(read.graph.layout, undefined);
  // The owner saves in the editor meanwhile.
  const owner = (await doc(id)).draft as FlowGraph;
  await h.env.client.call("flows.draft_save", {
    flow: id,
    expectedVersion: 1,
    graph: { ...owner, nodes: owner.nodes.map((n) => ({ ...n, label: `${n.label}!` })) },
  });
  assert.deepEqual(
    [events.at(-1)?.flow, events.at(-1)?.draft_version, events.at(-1)?.by],
    [id, 2, null],
    "the owner's own save is told too, by nobody",
  );
  const stale = await h.ask({
    method: "flows.draft_save",
    params: { flow: id, expectedVersion: read.draftVersion, graph: read.graph },
  });
  assert.match(stale.answer, /not saved: the draft changed since you read it/);
  assert.equal((await doc(id)).draft?.nodes[0]?.label, "New lead!");
  const missing = await h.ask({ method: "flows.draft_save", params: { flow: id, graph: read.graph } });
  assert.match(missing.answer, /pass expectedVersion/);
});

test("how freely an AI step acts stays the owner's", async () => {
  const id = madeId((await h.ask(leads())).answer);
  const raised = await h.ask({
    method: "flows.draft_save",
    params: {
      flow: id,
      edits: [{ op: "add", after: "save", step: { kind: "agent", agent: "roby", prompt: "Go", autonomy: "total" } }],
    },
  });
  assert.match(raised.answer, /not saved: step "agent": autonomy stays the owner's/);
  assert.equal((await doc(id)).draftVersion, 1);
});

test("a step the owner limited keeps its limits, who it runs as and its place; who drew the draft is kept", async () => {
  const id = madeId((await h.ask(leads())).answer);
  assert.equal((await doc(id)).draftBy, "roby");
  const mine = (await doc(id)).draft as FlowGraph;
  const limited = {
    id: "think",
    kind: "agent" as const,
    label: "Think",
    agent: "roby",
    prompt: "Sum up",
    autonomy: "manual" as const,
    input: { kind: "event" as const, path: [] },
  };
  await h.env.client.call("flows.draft_save", {
    flow: id,
    expectedVersion: 1,
    graph: { ...mine, nodes: [...mine.nodes, limited], edges: [...mine.edges, { source: "save", target: "think" }] },
  });
  assert.equal((await doc(id)).draftBy, null);
  const edit = async (edits: object[]) =>
    (await h.ask({ method: "flows.draft_save", params: { flow: id, edits } })).answer;
  assert.match(
    await edit([{ op: "update", step: "think", set: { bot: { name: "Any", system: "Do it." } } }]),
    /not saved: step "think" runs with limits the owner set: its bot stays as the owner chose it/,
  );
  assert.match(await edit([{ op: "remove", step: "think" }]), /only the owner removes it, in the editor/);
  assert.match(await edit([{ op: "update", step: "think", set: { prompt: "Sum it up in a line" } }]), /draftVersion 3/);
  assert.equal((await doc(id)).draftBy, "roby");
});

test("the owner's edits saved under an agent's draft they have not reviewed keep it waiting for review", async () => {
  const id = madeId((await h.ask(leads())).answer);
  const drawn = (await doc(id)).draft as FlowGraph;
  const moved = { ...drawn, layout: drawn.layout.map((p) => ({ ...p, y: p.y + 40 })) };
  const before = events.length;
  const kept = await h.env.client.call("flows.draft_save", {
    flow: id,
    expectedVersion: 1,
    graph: moved,
    unreviewed: true,
  });
  assert.deepEqual([kept.draftVersion, kept.draftBy], [2, "roby"], "still the agent's to review");
  assert.equal(events.at(-1)?.by, null, "the owner's own save, told by nobody");
  assert.equal(events.length, before + 1);
  // The editor's Save makes it the owner's; after that the flag names nobody.
  const saved = await h.env.client.call("flows.draft_save", { flow: id, expectedVersion: 2, graph: moved });
  assert.equal(saved.draftBy, null);
  const again = await h.env.client.call("flows.draft_save", {
    flow: id,
    expectedVersion: 3,
    graph: drawn,
    unreviewed: true,
  });
  assert.equal(again.draftBy, null, "an owner's draft never becomes an agent's");
});

test("an agent reaches the Flows of its project only, and nothing reaches them without an agent behind it", async () => {
  const id = madeId((await h.ask(leads())).answer);
  const as = (agent: string) => ({
    actor: "agent" as const,
    agent: { id: agent, run_id: "run-test", thread_id: "thread-test" },
    transport: "internal" as const,
    role: "operator" as const,
    session: undefined,
    log: createLog("test", true),
  });
  const writer = (await h.env.client.call("agents.list", {})).agents.find((a) => a.slug === "acme-writer")?.id ?? "";
  const ok = await h.env.core.dispatch("flows.graph_get", { flow: id }, as(writer));
  assert.equal(ok.ok, true);
  const graph = (await doc(id)).draft as FlowGraph;
  const away = await h.env.core.dispatch("flows.create", { project: northwind, name: "Away", graph }, as(writer), "k1");
  assert.equal(away.ok, false);
  assert.ok(!away.ok && away.error.code === "not_found");
  // The Flow is there, but not for an agent of another project.
  const other = await h.env.client.call("flows.create", { project: northwind, name: "Theirs", graph });
  const peek = await h.env.core.dispatch("flows.graph_get", { flow: other.flow.id }, as(writer));
  assert.ok(!peek.ok && peek.error.code === "not_found");
  // An agent's shell or an outside app: no agent behind the call.
  const shell = new ApxClient({ url: h.env.core.url, actor: "agent" });
  await assert.rejects(shell.call("flows.graph_get", { flow: id }), /reserved to the owner and their agents' tools/);
  const app = await h.env.client.call("clients.create", { name: "Acme app", scopes: ["chat"] });
  const outsider = new ApxClient({ url: h.env.core.url, clientToken: app.token });
  await assert.rejects(outsider.call("flows.create", { project: acme, name: "X", graph }), /outside/);
  // Publishing stays the owner's.
  const publish = await h.env.core.dispatch(
    "flows.publish",
    { flow: id, expectedDraftVersion: 1, expectedPublishedRevision: null },
    as("roby"),
    "k2",
  );
  assert.ok(!publish.ok && /reserved to the owner/.test(publish.error.message));
});

test("drafts and whole drawings ask only with outside content in the turn, checks never, and turning a Flow on always", () => {
  const [tool] = flowTools(h.env.core.store);
  const confirm = (method: string, params?: object) => tool?.confirm({ method, ...(params ? { params } : {}) });
  assert.equal(confirm("flows.draft_save", { flow: "x", edits: [{ op: "tidy" }] }), "untrusted");
  assert.equal(confirm("flows.create", { project: acme, name: "x", edits: [{ op: "tidy" }] }), "untrusted");
  // A whole drawing goes back to the model: asked with outside content around, like a change.
  assert.equal(confirm("flows.graph_get", { flow: "x" }), "untrusted");
  assert.equal(confirm("flows.validate", { flow: "x" }), "never");
  assert.equal(
    confirm("flows.set", {
      id: "x",
      projectId: acme,
      name: "x",
      enabled: true,
      predicates: [],
      tableKey: "latest",
      action: { kind: "none" },
    }),
    "always",
  );
});

test("the list says which Flows wait as drafts", async () => {
  const list = (await h.ask({ method: "flows.list", params: { project: acme } })).answer;
  assert.match(
    list,
    /^- New leads \[new-leads-[a-z0-9]+\] in the project Acme \([^)]+\): off, draft version 1 not published$/m,
  );
});
