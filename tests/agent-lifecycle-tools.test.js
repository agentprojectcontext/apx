// The super-agent's native agent-lifecycle tools: create_agent,
// set_agent_prompt, write_agent_memory.
//
// Regression they close: asked to "create the golf agent", the super-agent had
// no native way to do it. It shelled out to `apx agent add` (awkward for a long
// prompt), got a body-less agent, hand-wrote the `.md`, then thrashed trying to
// seed the new agent's memory. These tools let it build a fully-formed agent the
// same first-class way it creates tasks and routines.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-agentlc-"));
process.env.HOME = TMP_HOME;

const createAgentTool = (await import("#core/agent/tools/handlers/create-agent.js")).default;
const setPromptTool = (await import("#core/agent/tools/handlers/set-agent-prompt.js")).default;
const writeMemTool = (await import("#core/agent/tools/handlers/write-agent-memory.js")).default;
const { readAgents } = await import("#core/apc/parser.js");
const { readAgentMemory } = await import("#core/agent/memory.js");

let root, storage, projects, ctx, rebuilt;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(TMP_HOME, "proj-"));
  storage = fs.mkdtempSync(path.join(TMP_HOME, "store-"));
  fs.mkdirSync(path.join(root, ".apc", "agents"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".apc", "project.json"),
    JSON.stringify({ name: "default", apx_id: "testapx00lc01" }),
  );
  const entry = { id: 0, name: "default", path: root, storagePath: storage };
  rebuilt = [];
  projects = {
    list: () => [entry],
    get: (id) => (String(id) === "0" ? entry : null),
    rebuild: (id) => rebuilt.push(id),
  };
  ctx = { projects, requirePermission: async () => {} };
});

test("create_agent writes the agent WITH its system prompt and rebuilds", async () => {
  const r = await createAgentTool.makeHandler(ctx)({
    project: "default",
    slug: "golf-coach",
    system: "You are Golf Coach, Manu's golf instructor.",
    role: "Golf coach",
    skills: ["golf-lvl-2"],
  });
  assert.equal(r.ok, true);
  assert.equal(r.agent, "golf-coach");
  const a = readAgents(root).find((x) => x.slug === "golf-coach");
  assert.ok(a, "agent written to disk");
  assert.match(a.body, /Golf Coach/i, "system prompt landed in the body");
  assert.equal(a.fields.Role, "Golf coach");
  assert.deepEqual(a.fields.Skills, ["golf-lvl-2"]);
  assert.deepEqual(rebuilt, [0], "registry rebuilt once");
});

test("create_agent REFUSES a body-less agent (the guard)", async () => {
  const r = await createAgentTool.makeHandler(ctx)({ slug: "no-body" });
  assert.ok(r.error && /system/i.test(r.error), `expected a system-required error, got ${JSON.stringify(r)}`);
  assert.ok(!readAgents(root).some((x) => x.slug === "no-body"), "nothing written");
  assert.deepEqual(rebuilt, [], "no rebuild on a rejected create");
});

test("create_agent rejects a duplicate slug", async () => {
  const make = createAgentTool.makeHandler(ctx);
  await make({ slug: "dup", system: "x" });
  const r = await make({ slug: "dup", system: "y" });
  assert.ok(r.error && /already exists/i.test(r.error));
});

test("set_agent_prompt replaces the body but keeps the frontmatter", async () => {
  await createAgentTool.makeHandler(ctx)({ slug: "coach", system: "old prompt", role: "Coach", skills: ["golf-lvl-2"] });
  const r = await setPromptTool.makeHandler(ctx)({ agent: "coach", system: "new and better prompt" });
  assert.equal(r.ok, true);
  const a = readAgents(root).find((x) => x.slug === "coach");
  assert.match(a.body, /new and better prompt/);
  assert.doesNotMatch(a.body, /old prompt/);
  assert.equal(a.fields.Role, "Coach", "role preserved");
  assert.deepEqual(a.fields.Skills, ["golf-lvl-2"], "skills preserved");
});

test("set_agent_prompt errors on an unknown agent", async () => {
  const r = await setPromptTool.makeHandler(ctx)({ agent: "ghost", system: "x" });
  assert.ok(r.error && /not found/i.test(r.error));
});

test("write_agent_memory appends a dated line under Recent context", async () => {
  await createAgentTool.makeHandler(ctx)({ slug: "coach", system: "prompt" });
  const r = await writeMemTool.makeHandler(ctx)({ agent: "coach", content: "Taught the grip today." });
  assert.equal(r.ok, true);
  assert.equal(r.mode, "append");
  const mem = readAgentMemory({ id: 0, path: root, storagePath: storage }, "coach");
  assert.match(mem, /## Recent context/);
  assert.match(mem, /Taught the grip today\./);
});

test("write_agent_memory replace overwrites the whole file", async () => {
  await createAgentTool.makeHandler(ctx)({ slug: "coach", system: "prompt" });
  const write = writeMemTool.makeHandler(ctx);
  await write({ agent: "coach", content: "first" });
  const r = await write({ agent: "coach", content: "# Fresh memory\n", mode: "replace" });
  assert.equal(r.ok, true);
  const mem = readAgentMemory({ id: 0, path: root, storagePath: storage }, "coach");
  assert.equal(mem, "# Fresh memory\n");
  assert.doesNotMatch(mem, /first/);
});

test("write_agent_memory errors on an unknown agent", async () => {
  const r = await writeMemTool.makeHandler(ctx)({ agent: "ghost", content: "x" });
  assert.ok(r.error && /not found/i.test(r.error));
});
