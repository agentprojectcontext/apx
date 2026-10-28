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

function fixture(cwd = "") {
  const calls: unknown[] = [];
  const store = { projects: { list: () => [] } } as unknown as Store;
  const ctx = {
    agent: { id: "reader", autonomy: "total", rules: {} },
    thread: { id: "chat", cwd, reach: "fenced" },
    callAsOwner: async (method: string, params: unknown) => {
      calls.push({ method, params });
      return { url: "https://example.com/", json: '{"ok":true}' };
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
  assert.equal(authorize(tool, { script: "1" }, ctx.agent, false).kind, "confirm");
  assert.throws(() => tool.check?.({ tab: "mine" }, ctx), /exactly one/);
  assert.throws(() => tool.check?.({ tab: "mine", script: "1", path: "a.js" }, ctx), /exactly one/);
  assert.throws(() => tool.check?.({ tab: "mine", path: "https://example.com/a.js" }, ctx), /sha256/);
  await assert.rejects(tool.run({ tab: "other", script: "1" }, ctx), /wrong profile/);
  assert.equal(calls.length, 0);
  assert.match(await tool.run({ tab: "mine", script: "1" }, { ...ctx, callAsOwner: undefined }), /not run/);
  assert.equal(calls.length, 0);
  assert.match(await tool.run({ tab: "mine", script: "1" }, ctx), /untrusted.*web_javascript/s);
  assert.deepEqual(calls, [{ method: "browser.evaluate", params: { tab: "mine", script: "1", by: "reader" } }]);
});

test("local JavaScript requires the approved bytes and normal folder access", async () => {
  const dir = tempDir("apx-js-");
  try {
    const { tool, ctx, calls } = fixture(dir.path);
    const vm = browserEvaluateTool({} as Store, dir.path, async (_ctx, tab) => tab, { hasThread: () => true });
    assert.throws(
      () => vm.check?.({ tab: "mine", path: "script.js", sha256: "0".repeat(64) }, ctx),
      /host file access refused/,
    );
    await assert.rejects(
      vm.run({ tab: "mine", path: "script.js", sha256: "0".repeat(64) }, ctx),
      /host file access refused/,
    );
    const script = "Promise.resolve(42)";
    const sha256 = createHash("sha256").update(script).digest("hex");
    const args = { tab: "mine", path: "script.js", sha256 };
    fs.writeFileSync(path.join(dir.path, "script.js"), script);
    await tool.run(args, ctx);
    assert.deepEqual(calls, [{ method: "browser.evaluate", params: { tab: "mine", script, by: "reader" } }]);
    fs.writeFileSync(path.join(dir.path, "script.js"), "42");
    await assert.rejects(tool.run(args, ctx), /changed/);
    await assert.rejects(tool.run({ ...args, path: "../outside.js" }, ctx), /outside|folder|refused/i);
    assert.equal(calls.length, 1);
  } finally {
    await dir.remove();
  }
});
