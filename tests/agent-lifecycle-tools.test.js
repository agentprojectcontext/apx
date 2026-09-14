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
process.env.APX_HOME = path.join(TMP_HOME, ".apx"); // isolate the apx home too — HOME alone is overridden by the runner's APX_HOME

const createAgentTool = (await import("#core/agent/tools/handlers/create-agent.js")).default;
const configureAgentTool = (await import("#core/agent/tools/handlers/configure-agent.js")).default;
const setPromptTool = (await import("#core/agent/tools/handlers/set-agent-prompt.js")).default;
const writeMemTool = (await import("#core/agent/tools/handlers/write-agent-memory.js")).default;
const { readAgents } = await import("#core/apc/parser.js");
const { readAgentMemory } = await import("#core/agent/memory.js");
const { scopeProjects } = await import("#core/apc/projects-helpers.js");

let root, storage, other, otherStorage, projects, ctx, scopedCtx, rebuilt;

/** A project on disk, the minimum these tools need to read and write agents. */
function mkProject(name, apxId, prefix) {
  const dir = fs.mkdtempSync(path.join(TMP_HOME, prefix));
  fs.mkdirSync(path.join(dir, ".apc", "agents"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".apc", "project.json"),
    JSON.stringify({ name, apx_id: apxId }),
  );
  return dir;
}

beforeEach(() => {
  root = mkProject("default", "testapx00lc01", "proj-");
  storage = fs.mkdtempSync(path.join(TMP_HOME, "store-"));
  // A SECOND project. With only the default one registered, "which project did
  // this land in" has one possible answer and the scoping tests below cannot
  // fail — which is how ten handlers kept a `|| "default"` nobody noticed.
  other = mkProject("postbeam", "testapx00lc02", "other-");
  otherStorage = fs.mkdtempSync(path.join(TMP_HOME, "store-other-"));
  const entry = { id: 0, name: "default", path: root, storagePath: storage };
  const otherEntry = { id: 1, name: "postbeam", path: other, storagePath: otherStorage };
  rebuilt = [];
  projects = {
    list: () => [entry, otherEntry],
    get: (id) => (String(id) === "0" ? entry : String(id) === "1" ? otherEntry : null),
    rebuild: (id) => rebuilt.push(id),
  };
  ctx = { projects, requirePermission: async () => {} };
  // What a project agent's turn actually gets: the same registry with a
  // `current()` pointing at the project the agent belongs to. run-turn.js and
  // the routine runner both build this. See scopeProjects.
  scopedCtx = { projects: scopeProjects(projects, 1), requirePermission: async () => {} };
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

// ---------------------------------------------------------------------------
// Project scoping: an agent that lives in ONE project and omits `project` must
// write to its own, the same rule the read tools already follow (see
// tests/routine-project-scope.test.js). These handlers resolved
// `project || "default"`, which skips the scope branch in resolveProject
// entirely — so an orchestrator inside postbeam asked for a new agent, got one
// in the global default project, and was told it had been created.

test("create_agent with no project creates it in the agent's OWN project", async () => {
  const r = await createAgentTool.makeHandler(scopedCtx)({
    slug: "postbeam-writer",
    system: "You write the posts.",
  });
  assert.equal(r.ok, true);
  assert.equal(r.project.name, "postbeam", "the reply names where it landed");
  assert.ok(readAgents(other).some((a) => a.slug === "postbeam-writer"), "written to postbeam");
  assert.ok(!readAgents(root).some((a) => a.slug === "postbeam-writer"), "NOT the default project");
  assert.deepEqual(rebuilt, [1], "and the project rebuilt is the one written to");
});

test("configure_agent with no project edits its OWN project's copy", async () => {
  // The same slug in both projects — the sharp case, where resolving to the
  // wrong one succeeds instead of erroring, and the edit lands on a stranger.
  await createAgentTool.makeHandler(ctx)({ slug: "coach", system: "x", role: "Default coach" });
  await createAgentTool.makeHandler(scopedCtx)({ slug: "coach", system: "x", role: "Postbeam coach" });

  const r = await configureAgentTool.makeHandler(scopedCtx)({ agent: "coach", role: "Edited" });
  assert.equal(r.ok, true);
  assert.equal(r.project.name, "postbeam");
  assert.equal(readAgents(other).find((a) => a.slug === "coach").fields.Role, "Edited");
  assert.equal(
    readAgents(root).find((a) => a.slug === "coach").fields.Role,
    "Default coach",
    "the default project's agent of the same name is untouched",
  );
});

test("write_agent_memory with no project writes into its OWN project", async () => {
  await createAgentTool.makeHandler(scopedCtx)({ slug: "magui", system: "x" });
  const r = await writeMemTool.makeHandler(scopedCtx)({ agent: "magui", content: "backlog lleno 10/10" });
  assert.equal(r.ok, true);
  const mem = readAgentMemory({ id: 1, path: other, storagePath: otherStorage }, "magui");
  assert.match(mem, /backlog lleno 10\/10/, "the note is where the agent will read it");
});

test("an explicit project still wins over the scope", async () => {
  await createAgentTool.makeHandler(scopedCtx)({ project: "default", slug: "global-helper", system: "x" });
  assert.ok(readAgents(root).some((a) => a.slug === "global-helper"), "explicit 'default' honoured");
  assert.ok(!readAgents(other).some((a) => a.slug === "global-helper"));
});

test("an UNSCOPED registry still resolves to the default project (the super-agent)", async () => {
  const r = await createAgentTool.makeHandler(ctx)({ slug: "roby-helper", system: "x" });
  assert.equal(r.project.name, "default", "nothing changes for the agent that has no project");
  assert.ok(readAgents(root).some((a) => a.slug === "roby-helper"));
  assert.ok(!readAgents(other).some((a) => a.slug === "roby-helper"));
});
