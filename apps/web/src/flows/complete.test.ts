import assert from "node:assert/strict";
import { test } from "node:test";
import { newNode } from "../../../../packages/protocol/src/flow-edit.ts";
import type { FlowNode } from "../../../../packages/protocol/src/flow-graph.ts";
import { blank, stepGap } from "./complete.ts";

const js = (code: string): FlowNode => ({ ...(newNode("js", "js", "JS") as Extract<FlowNode, { kind: "js" }>), code });

test("the editor asks what the core asks: an empty setting, blank spaces included, keeps a step from running", () => {
  assert.equal(stepGap(js("return input;")), undefined);
  assert.equal(stepGap(js("")), "code");
  assert.equal(stepGap(js("   ")), "code");
  assert.equal(blank(newNode("cmd", "cmd", "Command")), true);
  assert.equal(stepGap(newNode("http", "http", "Call")), "url");
  assert.equal(stepGap({ ...newNode("http", "http", "Call"), url: "https://example.com/hook" } as FlowNode), undefined);
  assert.equal(stepGap({ ...newNode("notify", "n", "Tell"), channel: "telegram" } as FlowNode), "to");
});

test("a read or a save names a table, but for the steps an old definition was drawn with", () => {
  const save = (id: string, table?: string): FlowNode => ({
    ...(newNode("table_write", id, "Save") as Extract<FlowNode, { kind: "table_write" }>),
    key: "latest",
    ...(table ? { table } : {}),
  });
  assert.equal(stepGap(save("save-2")), "table");
  assert.equal(stepGap(save("save-2", "leads")), undefined);
  // The definition's own save keeps the Flow's own table.
  assert.equal(stepGap(save("save")), undefined);
});
