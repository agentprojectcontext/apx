import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { createLog } from "../log.ts";
import { createMcp } from "./manager.ts";

test("a sign-in waiting on an old transport cannot clear a newer disconnect receipt", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  const mcp = createMcp({
    store: env.core.store,
    secrets: env.core.secrets,
    log: createLog("test", true),
    workDir: env.home,
  });
  try {
    await env.client.call("mcp.set", { name: "receipt", server: { command: process.execPath, args: [SERVER] } });
    const def = mcp.find("global", "receipt");
    assert.ok(def);
    assert.ok((await mcp.toolPermissions(def)).length);
    const signing = mcp.signIn(def);
    const target = { scope: "global" as const, name: "receipt" };
    const release = mcp.suspend([target]);
    try {
      mcp.requireSignIn([target]);
      await assert.rejects(signing, /disconnected|being updated/);
      await mcp.drop(target, true);
    } finally {
      release();
    }
    assert.equal(mcp.status().find((s) => s.name === "receipt")?.status, "needs-sign-in");
    assert.equal((await mcp.test(def)).ok, false);
    await mcp.signIn(def);
    assert.equal(mcp.status().find((s) => s.name === "receipt")?.status, "ready");
  } finally {
    await mcp.close();
    await env.core.close();
    await env.cleanup();
  }
});

const SERVER = path.join(import.meta.dirname, "fake-server.test-support.mjs");

test("a suspended server cannot reopen while concurrent drops finish", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  const mcp = createMcp({
    store: env.core.store,
    secrets: env.core.secrets,
    log: createLog("test", true),
    workDir: env.home,
  });
  try {
    await env.client.call("mcp.set", { name: "lifecycle", server: { command: process.execPath, args: [SERVER] } });
    const def = mcp.find("global", "lifecycle");
    assert.ok(def);
    assert.ok((await mcp.toolPermissions(def)).length);
    const server = { scope: "global" as const, name: "lifecycle" };
    const release = mcp.suspend([server]);
    try {
      const first = mcp.drop(server);
      const second = mcp.drop(server);
      await assert.rejects(mcp.toolPermissions(def), /being updated/);
      assert.match((await mcp.test(def)).error ?? "", /being updated/);
      await Promise.all([first, second]);
      await assert.rejects(mcp.signIn(def), /being updated/);
    } finally {
      release();
    }
    assert.equal((await mcp.test(def)).ok, true);
  } finally {
    await mcp.close();
    await env.core.close();
    await env.cleanup();
  }
});
