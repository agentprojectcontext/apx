import assert from "node:assert/strict";
import { test } from "node:test";
import { ApxError } from "@apx/protocol/client";
import type { FlowGraph } from "../../../../packages/protocol/src/flow-graph.ts";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";

const hook = { id: "start", kind: "webhook" as const, label: "Webhook" };
const save = {
  id: "save",
  kind: "table_write" as const,
  label: "Save",
  key: "latest",
  value: { kind: "event" as const, path: [] },
};
const runs: FlowGraph = {
  schemaVersion: 2,
  nodes: [hook, save],
  edges: [{ source: "start", target: "save" }],
  layout: [],
};
/** What runs, plus a code step the owner has not written yet. */
const unfinished: FlowGraph = {
  ...runs,
  nodes: [
    hook,
    save,
    { id: "clean", kind: "js", label: "Clean up", code: "", input: { kind: "event", path: [] }, timeoutMs: 2000 },
  ],
  edges: [...runs.edges, { source: "save", target: "clean" }],
};
const refused = (code: string, node: string) => (error: unknown) => {
  assert.ok(error instanceof ApxError);
  const issues = (error.detail as { issues?: { code: string; node?: string }[] } | undefined)?.issues ?? [];
  assert.deepEqual(
    issues.map((i) => [i.code, i.node]),
    [[code, node]],
  );
  return true;
};

test("a draft keeps a step not finished yet; publishing names it and what runs stays as it was", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("unused")) });
  try {
    const project = (await env.client.call("projects.create", { name: "Acme" })).project.id;
    await env.client.call("flows.set", {
      id: "leads",
      projectId: project,
      name: "Leads",
      enabled: false,
      predicates: [],
      tableKey: "latest",
      action: { kind: "none" },
    });
    const first = await env.client.call("flows.draft_save", { flow: "leads", expectedVersion: null, graph: runs });
    const live = await env.client.call("flows.publish", {
      flow: "leads",
      expectedDraftVersion: first.draftVersion ?? 0,
      expectedPublishedRevision: null,
    });
    const flow = env.core.store.flows.get("leads");
    assert.ok(flow);
    await env.client.call("flows.set", { ...flow, enabled: true });

    // On, the unfinished drawing saves as a draft: nothing it holds runs.
    const draft = await env.client.call("flows.draft_save", {
      flow: "leads",
      expectedVersion: live.draftVersion,
      graph: unfinished,
    });
    assert.equal(draft.draft?.nodes.find((n) => n.id === "clean")?.kind, "js");
    assert.deepEqual(draft.published, live.published);
    assert.equal(draft.publishedRevision, 1);

    // Validate says which step to finish, and which setting.
    const { valid, issues } = await env.client.call("flows.validate", { flow: "leads", graph: unfinished });
    assert.equal(valid, false);
    assert.deepEqual(issues, [
      { code: "step_incomplete", node: "clean", message: 'Step "Clean up" needs its code before it can run' },
    ]);

    // Publishing refuses it, naming the step; what runs is still revision 1.
    await assert.rejects(
      env.client.call("flows.publish", {
        flow: "leads",
        expectedDraftVersion: draft.draftVersion ?? 0,
        expectedPublishedRevision: 1,
      }),
      refused("step_incomplete", "clean"),
    );
    const after = await env.client.call("flows.graph_get", { flow: "leads" });
    assert.equal(after.publishedRevision, 1);
    assert.deepEqual(after.published, runs);

    // The list shows the draft's steps, as a draft.
    const list = await env.client.call("flows.list", {});
    assert.deepEqual(list.drafts.leads, { version: draft.draftVersion, kinds: ["webhook", "table_write", "js"] });
    assert.deepEqual(list.published.leads?.kinds, ["webhook", "table_write"]);

    // A try and what runs never take an unfinished step.
    await assert.rejects(env.client.call("flows.try_graph", { graph: unfinished, data: { a: 1 } }), ApxError);
    await assert.rejects(env.client.call("flows.outward", { flow: "leads", graph: unfinished }), ApxError);

    // Finished, it publishes.
    const done = await env.client.call("flows.draft_save", {
      flow: "leads",
      expectedVersion: draft.draftVersion,
      graph: {
        ...unfinished,
        nodes: unfinished.nodes.map((n) => (n.kind === "js" ? { ...n, code: "return input;" } : n)),
      },
    });
    const next = await env.client.call("flows.publish", {
      flow: "leads",
      expectedDraftVersion: done.draftVersion ?? 0,
      expectedPublishedRevision: 1,
    });
    assert.equal(next.publishedRevision, 2);
    assert.equal((await env.client.call("flows.list", {})).drafts.leads, undefined);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("a new Flow can start from an unfinished drawing, and its list row shows the draft", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("unused")) });
  try {
    const project = (await env.client.call("projects.create", { name: "Acme" })).project.id;
    const made = await env.client.call("flows.create", { project, name: "Leads", graph: unfinished });
    assert.equal(made.flow.enabled, false);
    assert.equal(made.document.draft?.nodes.length, 3);
    const list = await env.client.call("flows.list", { project });
    // Its definition is the table-only placeholder; the list shows the drawing instead.
    assert.deepEqual(list.drafts[made.flow.id]?.kinds, ["webhook", "table_write", "js"]);
    assert.equal(list.published[made.flow.id], undefined);
    // Strict parsing still refuses a draft whose shape is not a step's.
    await assert.rejects(
      env.client.call("flows.draft_save", {
        flow: made.flow.id,
        expectedVersion: made.document.draftVersion,
        graph: { ...unfinished, nodes: [hook, { ...save, unknown: true }] } as unknown as FlowGraph,
      }),
      ApxError,
    );
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
