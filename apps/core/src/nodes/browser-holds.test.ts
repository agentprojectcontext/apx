import assert from "node:assert/strict";
import { test } from "node:test";
import { createBrowserHolds, type HoldTarget } from "./browser-holds.ts";

test("a turn holds the tabs it uses until it ends, and a new browser hears every hold again", () => {
  const sent: Array<[string, string, string[]]> = [];
  let key = "node-1";
  const target = (): HoldTarget => ({ key, send: async (run, tabs) => sent.push([key, run, tabs]) });
  const holds = createBrowserHolds(target);
  holds.hold("r1", "t1");
  holds.hold("r1", "t1");
  holds.hold("r2", "t2");
  assert.deepEqual(sent, [
    ["node-1", "r1", ["t1"]],
    ["node-1", "r2", ["t2"]],
  ]);
  key = "node-2";
  sent.length = 0;
  holds.hold("r1", "t3");
  assert.deepEqual(sent, [
    ["node-2", "r1", ["t1", "t3"]],
    ["node-2", "r2", ["t2"]],
  ]);
  sent.length = 0;
  holds.end("r1");
  holds.hold("r1", "t1");
  assert.deepEqual(sent, [["node-2", "r1", []]]);
});
