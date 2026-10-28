import assert from "node:assert/strict";
import { test } from "node:test";
import { tryFlowGraph } from "./flow-graph-try.ts";
import { parseFlowTemplate, renderFlowTemplate } from "./flow-template.ts";

test("templates read the payload and earlier steps as bindings, and evaluate nothing", () => {
  assert.deepEqual(parseFlowTemplate("Lead $trigger.body.company: $steps.think-1.text, $$5"), [
    { text: "Lead " },
    { binding: { kind: "event", path: ["body", "company"] }, source: "$trigger.body.company" },
    { text: ": " },
    { binding: { kind: "node", node: "think-1", path: ["text"] }, source: "$steps.think-1.text" },
    { text: ", $5" },
  ]);
  // A sentence's full stop is not a field; `${…}` and other shapes stay text.
  assert.deepEqual(parseFlowTemplate("Hi $trigger.name. ${x}")[2], { text: ". ${x}" });
  assert.throws(() => parseFlowTemplate("$trigger.__proto__.x"), /not allowed/);
  assert.throws(() => parseFlowTemplate("$steps"), /names no step/);
  const values: Record<string, unknown> = { a: "Acme", n: 3, list: [], obj: { k: 1 } };
  const resolve = (b: { kind: string; path?: string[] }) => {
    const key = b.path?.[0] ?? "";
    if (!(key in values)) throw new Error("missing");
    return values[key];
  };
  assert.deepEqual(renderFlowTemplate(parseFlowTemplate("$trigger.a has $trigger.n $trigger.obj"), resolve), {
    text: 'Acme has 3 {"k":1}',
    empty: false,
  });
  assert.throws(() => renderFlowTemplate(parseFlowTemplate("$trigger.gone"), resolve), /missing/);
  assert.deepEqual(
    renderFlowTemplate(parseFlowTemplate("Nothing: $trigger.list $trigger.gone"), resolve, { missing: "empty" }),
    {
      text: "Nothing: [] ",
      empty: true,
    },
  );
  // Literal text may be rewritten (where secret references are read); a bound value never is.
  const out = renderFlowTemplate(parseFlowTemplate("secret://k $trigger.a"), () => "secret://k", {
    literal: (t) => t.replace("secret://k", "VALUE"),
  });
  assert.equal(out.text, "VALUE secret://k");
});

test("Try a run says a notify step would send, or would skip when there is nothing to tell", () => {
  const graph = {
    schemaVersion: 2 as const,
    nodes: [
      { id: "start", kind: "webhook" as const, label: "Webhook" },
      {
        id: "say",
        kind: "notify" as const,
        label: "Say",
        channel: "chat",
        to: { kind: "room" as const, room: "900" },
        text: "Stock: $trigger.items",
        onlyIfContent: true,
      },
    ],
    edges: [{ source: "start", target: "say" }],
    layout: [],
  };
  assert.equal(tryFlowGraph(graph, { items: [] }).find((s) => s.node === "say")?.state, "skipped");
  assert.equal(tryFlowGraph(graph, { items: ["lamp"] }).find((s) => s.node === "say")?.state, "would_run");
});
