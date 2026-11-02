import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import type { Executor } from "./bridge.ts";
import { AccessibilityLabBridge, BridgeError, LIMITS } from "./bridge.ts";

function setup(data: unknown) {
  const commands: string[] = [];
  const execute: Executor = async (_binary, args) => {
    const command = args[2];
    assert.ok(command);
    commands.push(command);
    return {
      stdout: JSON.stringify({
        version: "2.5",
        ok: true,
        command,
        data: command === "version" ? { version: "1.0.2" } : data,
      }),
      stderr: "",
      exitCode: 0,
    };
  };
  return {
    commands,
    bridge: new AccessibilityLabBridge({
      binary: resolve("synthetic-bin"),
      home: resolve("synthetic-home"),
      namespace: "lab",
      expectedVersion: "1.0.2",
      execute,
      authorize: () => true,
    }),
  };
}
const node = { ref_id: "@s1:e1", role: "button", states: [], available_actions: ["Click"] };
function data(tree: unknown, refCount = 1) {
  return { app: "Acme", window: { id: "42" }, snapshot_id: "s1", complete: true, ref_count: refCount, tree };
}
function code(expected: string) {
  return (error: unknown) => error instanceof BridgeError && error.code === expected;
}

test("duplicate refs and incorrect ref count fail without exposing partial store", async () => {
  for (const value of [data({ ...node, children: [node] }, 2), data(node, 2)]) {
    const h = setup(value);
    await assert.rejects(h.bridge.snapshot(), code("INVALID_OUTPUT"));
    await assert.rejects(
      h.bridge.click({ snapshot: "s1", ref: "@s1:e1", app: "Acme", window: "42" }),
      code("STALE_OR_FOREIGN_REF"),
    );
    assert.deepEqual(h.commands, ["version", "snapshot"]);
  }
});

test("depth and node caps fail closed within byte budget", async () => {
  let deep: unknown = { role: "group" };
  for (let depth = 0; depth < LIMITS.depth + 1; depth++) deep = { role: "group", children: [deep] };
  for (const tree of [
    deep,
    { role: "group", children: Array.from({ length: LIMITS.nodes }, () => ({ role: "button" })) },
  ]) {
    const h = setup(data(tree, 0));
    await assert.rejects(h.bridge.snapshot(), code("TREE_LIMIT"));
    assert.deepEqual(h.commands, ["version", "snapshot"]);
  }
});

test("budget truncation refused; intentional skeleton can be expanded later", async () => {
  const h = setup(data({ ...node, subtree_truncated: true, children_count: 3 }));
  await assert.rejects(h.bridge.snapshot(), code("INCOMPLETE_SNAPSHOT"));
  const skeleton = await h.bridge.snapshot({ skeleton: true });
  assert.equal(skeleton.tree.role, "button");
  assert.deepEqual(h.commands, ["version", "snapshot", "snapshot"]);
});

test("snapshot output omits values and arbitrary native fields, accepts nameless controls", async () => {
  const h = setup(
    data({ ...node, name: "", value: "synthetic sensitive value", description: "not returned", extra: "untrusted" }),
  );
  const s = await h.bridge.snapshot();
  assert.deepEqual(Object.keys(s.tree).sort(), ["actions", "children", "name", "ref", "role", "states"]);
  assert.equal(s.tree.name, undefined);
  assert.equal(JSON.stringify(s).includes("synthetic sensitive value"), false);
  assert.equal(JSON.stringify(s).includes("@s1:e1"), false);
  assert.deepEqual(h.commands, ["version", "snapshot"]);
});
