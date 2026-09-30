// Writing a credentials file asks the owner in every permission mode, `total`
// included. A shell one-liner over ~/.apx/config.json or an mcps.json can drop
// a token no later turn can recover, and nothing else looked at what a write
// touches.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-secret-guard-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx");

const { test, after } = await import("node:test");
const { default: assert } = await import("node:assert/strict");
const { isSecretPath, secretWriteTarget } = await import("#core/agent/loop/secret-guard.js");
const { runAgent } = await import("#core/agent/run-agent.js");
const { createToolSession } = await import("#core/agent/tools/registry.js");

after(() => fs.rmSync(TMP_HOME, { recursive: true, force: true }));

const repo = fs.mkdtempSync(path.join(TMP_HOME, "repo-"));
const projects = { get: () => ({ id: 0, path: repo }), list: () => [{ id: 0, path: repo }] };
const ctx = { projects };

test("which files are secret stores", () => {
  const apx = process.env.APX_HOME;
  for (const f of [`${apx}/config.json`, `${apx}/mcps.json`, `${apx}/projects/abc123/mcps.json`, "/p/.env", "/p/.env.production", "/p/auth.json", "/p/server.pem", "/home/x/.ssh/id_ed25519"]) {
    assert.ok(isSecretPath(f), f);
  }
  for (const f of [`${apx}/memory.md`, "/p/.env.example", "/p/src/config.json", "/p/README.md"]) {
    assert.ok(!isSecretPath(f), f);
  }
});

test("file tools, patches and shell writes are caught; reads and the guarded CLI are not", () => {
  assert.ok(secretWriteTarget("write_file", { path: ".env", content: "X=1" }, ctx));
  assert.ok(secretWriteTarget("edit_file", { path: ".env", search: "a", replace: "b" }, ctx));
  assert.ok(secretWriteTarget("apply_patch", { patch: "*** Begin Patch\n*** Add File: .env.local\n+X=1\n*** End Patch" }, ctx));
  assert.equal(secretWriteTarget("write_file", { path: "src/app.js", content: "" }, ctx), null);
  assert.ok(secretWriteTarget("run_shell", { command: "jq '.engines={}' ~/.apx/config.json > /tmp/c && mv /tmp/c ~/.apx/config.json" }, ctx));
  assert.ok(secretWriteTarget("run_shell", { command: "sed -i '' 's/old/new/' ~/.apx/projects/abc/mcps.json" }, ctx));
  assert.equal(secretWriteTarget("run_shell", { command: "cat ~/.apx/config.json | jq .super_agent.model" }, ctx), null, "reading is not writing");
  assert.equal(secretWriteTarget("run_shell", { command: "apx config set --global super_agent.model zen:big-pickle" }, ctx), null, "the guarded CLI");
  assert.equal(secretWriteTarget("read_file", { path: ".env" }, ctx), null);
});

const cfg = { super_agent: { enabled: true, model: "mock:test", permission_mode: "total", model_fallback: { enabled: false } }, engines: {} };

async function writeEnv(requestConfirmation) {
  const session = createToolSession("web");
  const ran = [];
  const args = JSON.stringify({ path: ".env", content: "TOKEN=x" });
  const r = await runAgent({
    globalConfig: cfg, system: "sys",
    prompt: `[mock:tool:write_file] [mock:args:${args}] guardá el token`,
    toolSchemas: session.initialSchemas,
    makeToolHandlers: () => ({ write_file: async (a) => { ran.push(a); return { ok: true }; } }),
    toolHandlerCtx: { toolSession: session, globalConfig: cfg, projects, ...(requestConfirmation ? { requestConfirmation } : {}) },
    maxIters: 2,
  });
  return { ran, call: r.trace.find((t) => t.tool === "write_file") };
}

test("in `total`, a write to a secret store still needs the owner's yes", async () => {
  const noChannel = await writeEnv(null);
  assert.equal(noChannel.ran.length, 0, "a channel that cannot ask does not write");
  assert.match(noChannel.call.result.error, /holds credentials/);
  const declined = await writeEnv(async () => false);
  assert.equal(declined.ran.length, 0);
  const asked = [];
  const approved = await writeEnv(async (name, _args, description) => { asked.push({ name, description }); return true; });
  assert.equal(approved.ran.length, 1, "confirmed, it runs");
  assert.match(asked[0].description, /holds credentials/);
});
