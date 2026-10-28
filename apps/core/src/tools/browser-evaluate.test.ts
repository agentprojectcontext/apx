import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import type { Store } from "../domain/store.ts";
import { tempDir } from "../testkit/platform.ts";
import { browserEvaluateTool } from "./browser-evaluate.ts";
import { authorize } from "./policy.ts";
import type { ToolContext } from "./types.ts";

const origin = "https://example.com";
function fixture(cwd = "") {
  const calls: unknown[] = [];
  const store = { projects: { list: () => [] } } as unknown as Store;
  const ctx = {
    agent: { id: "reader", autonomy: "total", rules: {} },
    thread: { id: "chat", cwd, reach: "fenced" },
    callAsOwner: async (method: string, params: unknown) => {
      calls.push({ method, params });
      return { url: `${origin}/`, json: '{"ok":true}' };
    },
  } as unknown as ToolContext;
  const tool = browserEvaluateTool(store, path.join(cwd, "home"), async (_ctx, tab) => {
    if (tab !== "mine") throw new Error("wrong profile");
    return tab;
  });
  return { tool, ctx, calls };
}

test("browser JavaScript always retains approval, validates source, and wraps observations", async () => {
  const { tool, ctx, calls } = fixture();
  for (const autonomy of ["auto", "total"] as const)
    assert.equal(authorize(tool, { script: "1" }, { ...ctx.agent, autonomy }, false).kind, "confirm");
  assert.equal(
    authorize(tool, { script: "1" }, { ...ctx.agent, rules: { irreversible: "auto" } }, false).kind,
    "confirm",
  );
  assert.throws(() => tool.check?.({ tab: "mine", origin }, ctx), /exactly one/);
  assert.throws(
    () => tool.check?.({ tab: "mine", origin, document: "doc1", script: "1", path: "a.js" }, ctx),
    /exactly one/,
  );
  assert.throws(
    () => tool.check?.({ tab: "mine", origin, document: "doc1", path: "https://example.com/a.js" }, ctx),
    /sha256/,
  );
  const other = { tab: "other", origin, document: "doc1", script: "1" };
  await tool.check?.(other, ctx);
  await assert.rejects(tool.run(other, ctx), /wrong profile/);
  assert.equal(calls.length, 0);
  assert.match(
    await tool.run({ tab: "mine", origin, document: "doc1", script: "1" }, { ...ctx, callAsOwner: undefined }),
    /not run/,
  );
  const args = { tab: "mine", origin, document: "doc1", script: "1" };
  await tool.check?.(args, ctx);
  assert.match(tool.explain?.(args) ?? "", /Tab: mine\nOrigin: https:\/\/example.com[\s\S]*\n1$/);
  assert.match(await tool.run(args, ctx), /untrusted.*web_javascript/s);
  assert.deepEqual(calls, [
    { method: "browser.evaluate", params: { tab: "mine", origin, document: "doc1", script: "1", by: "reader" } },
  ]);
  await assert.rejects(tool.run(args, ctx), /not prepared/);
});

test("local JavaScript approves and executes one immutable source snapshot under normal folder rules", async () => {
  const dir = tempDir("apx-js-");
  try {
    const { tool, ctx, calls } = fixture(dir.path);
    const vm = browserEvaluateTool({} as Store, dir.path, async (_ctx, tab) => tab, { hasThread: () => true });
    const vmArgs = { tab: "mine", origin, document: "doc1", path: "script.js", sha256: "0".repeat(64) };
    assert.throws(() => vm.check?.(vmArgs, ctx), /host file access refused/);
    await assert.rejects(vm.run(vmArgs, ctx), /host file access refused/);
    const script = "Promise.resolve(42)";
    const sha256 = createHash("sha256").update(script).digest("hex");
    const args = { tab: "mine", origin, document: "doc1", path: "script.js", sha256 };
    fs.writeFileSync(path.join(dir.path, "script.js"), script);
    await tool.check?.(args, ctx);
    assert.match(tool.explain?.(args) ?? "", /Promise.resolve\(42\)$/);
    fs.writeFileSync(path.join(dir.path, "script.js"), "42");
    await tool.run(args, ctx);
    assert.deepEqual(calls, [
      { method: "browser.evaluate", params: { tab: "mine", origin, document: "doc1", script, by: "reader" } },
    ]);
    assert.throws(() => tool.check?.({ ...args }, ctx), /changed/);
    assert.throws(() => tool.check?.({ ...args, path: "../outside.js" }, ctx), /outside|folder|refused/i);
    assert.equal(calls.length, 1);
  } finally {
    await dir.remove();
  }
});
