// The APX-management tools that close the "can create but not manage" gaps:
// complete_task, mark_commitment, add_mcp, remove_agent, configure_agent.
// Each mirrors a CLI/route action the super-agent previously could only reach by
// shelling out.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-mgmt-"));
process.env.HOME = TMP_HOME;

const completeTask = (await import("#core/agent/tools/handlers/complete-task.js")).default;
const markCommitment = (await import("#core/agent/tools/handlers/mark-commitment.js")).default;
const addMcp = (await import("#core/agent/tools/handlers/add-mcp.js")).default;
const removeAgentTool = (await import("#core/agent/tools/handlers/remove-agent.js")).default;
const configureAgent = (await import("#core/agent/tools/handlers/configure-agent.js")).default;
const createAgentTool = (await import("#core/agent/tools/handlers/create-agent.js")).default;

const { createTask, getTask } = await import("#core/stores/tasks.js");
const { createCommitment } = await import("#core/stores/commitments.js");
const { readAgents } = await import("#core/apc/parser.js");
const { readApfMcps } = await import("#core/mcp/sources.js");

let root, storage, projects, ctx, rebuilt;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(TMP_HOME, "proj-"));
  storage = fs.mkdtempSync(path.join(TMP_HOME, "store-"));
  fs.mkdirSync(path.join(root, ".apc", "agents"), { recursive: true });
  fs.writeFileSync(path.join(root, ".apc", "project.json"), JSON.stringify({ name: "default", apx_id: "testmgmt0001" }));
  const entry = { id: 0, name: "default", path: root, storagePath: storage };
  rebuilt = [];
  projects = { list: () => [entry], get: (id) => (String(id) === "0" ? entry : null), rebuild: (id) => rebuilt.push(id) };
  ctx = { projects, registries: { evictName: () => {} }, requirePermission: async () => {} };
});

test("complete_task marks a task done", async () => {
  const t = createTask(storage, { title: "ship it" });
  const r = await completeTask.makeHandler(ctx)({ task: t.id, action: "done" });
  assert.equal(r.ok, true);
  assert.equal(getTask(storage, t.id).state, "done");
});

test("complete_task sets a workflow status", async () => {
  const t = createTask(storage, { title: "review it" });
  const r = await completeTask.makeHandler(ctx)({ task: t.id, action: "status", status: "blocked" });
  assert.equal(r.ok, true);
  assert.equal(getTask(storage, t.id).status, "blocked");
});

test("complete_task with action=status but no status errors", async () => {
  const t = createTask(storage, { title: "x" });
  const r = await completeTask.makeHandler(ctx)({ task: t.id, action: "status" });
  assert.ok(r.error && /status required/i.test(r.error));
});

test("mark_commitment marks kept, and renegotiate needs a due", async () => {
  const c = createCommitment(storage, { counterparty: "Ana", body: "send the deck", due: "2026-09-01" });
  const kept = await markCommitment.makeHandler(ctx)({ commitment: c.id, action: "kept" });
  assert.equal(kept.ok, true);

  const c2 = createCommitment(storage, { counterparty: "Beto", body: "call back" });
  const bad = await markCommitment.makeHandler(ctx)({ commitment: c2.id, action: "renegotiate" });
  assert.ok(bad.error && /due required/i.test(bad.error));
  const good = await markCommitment.makeHandler(ctx)({ commitment: c2.id, action: "renegotiate", due: "2026-09-10" });
  assert.equal(good.ok, true);
});

test("add_mcp registers a stdio server in the shared scope", async () => {
  const r = await addMcp.makeHandler(ctx)({ name: "fs", command: "npx", args: ["-y", "server-filesystem"], scope: "shared" });
  assert.equal(r.ok, true);
  assert.equal(r.transport, "stdio");
  const json = readApfMcps(root);
  assert.ok(json.mcpServers.fs, "server written to .apc/mcps.json");
  assert.equal(json.mcpServers.fs.command, "npx");
  assert.equal(json.mcpServers.fs.enabled, true);
});

test("add_mcp rejects a server with neither command nor url", async () => {
  const r = await addMcp.makeHandler(ctx)({ name: "bad", scope: "shared" });
  assert.ok(r.error && /command|url/i.test(r.error));
});

test("configure_agent edits frontmatter without touching the prompt", async () => {
  await createAgentTool.makeHandler(ctx)({ slug: "coach", system: "the prompt", role: "Coach" });
  const r = await configureAgent.makeHandler(ctx)({ agent: "coach", model: "ollama:llama3.2:3b", area: "sports" });
  assert.equal(r.ok, true);
  const a = readAgents(root).find((x) => x.slug === "coach");
  assert.equal(a.fields.Model, "ollama:llama3.2:3b");
  assert.match(a.body, /the prompt/, "system prompt preserved");
});

test("remove_agent deletes the definition", async () => {
  await createAgentTool.makeHandler(ctx)({ slug: "temp", system: "x" });
  assert.ok(readAgents(root).some((a) => a.slug === "temp"));
  const r = await removeAgentTool.makeHandler(ctx)({ agent: "temp" });
  assert.equal(r.ok, true);
  assert.ok(!readAgents(root).some((a) => a.slug === "temp"));
});

test("remove_agent errors on an unknown agent", async () => {
  const r = await removeAgentTool.makeHandler(ctx)({ agent: "ghost" });
  assert.ok(r.error && /not found/i.test(r.error));
});
