// Per-turn project context. The owner names a project from a surface pinned to
// `default` (Telegram) and the agent must learn, without being told, who works
// on that project, which MCP servers it has, and which of its folders carry
// their own rules — the ones that decide whether a post is scheduled or
// published on the spot.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-turn-context-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx");

const { test, after } = await import("node:test");
const { default: assert } = await import("node:assert/strict");
const ctx = await import("#core/agent/context/turn-context.js");
const { attachDirectoryRules } = await import("#core/agent/loop/directory-rules.js");
const { recordMcpTools, describeMcpLine } = await import("#core/mcp/catalog.js");
const { runSuperAgent } = await import("#core/agent/super-agent.js");
const { buildAgentSystem } = await import("#core/agent/build-agent-system.js");
const { ProjectManager } = await import("#host/daemon/db.js");
const { CHANNELS } = await import("#core/constants/channels.js");
const { makeTempProject, cleanupTempProject } = await import("./_helpers.js");

const root = makeTempProject({ name: "Northwind Media", agents: [{ slug: "editor", role: "Edits reels" }] });
fs.writeFileSync(
  path.join(root, ".apc", "agents", "lead.md"),
  "---\nrole: Runs the content pipeline\ntype: orchestrator\n---\n\nYou lead.\n"
);
fs.writeFileSync(path.join(root, "AGENTS.md"), "# Northwind\nRoot rule: every post is reviewed.\n");
fs.mkdirSync(path.join(root, "social", "reels", "node_modules", "x"), { recursive: true });
fs.writeFileSync(path.join(root, "social", "AGENTS.md"), "Social rule: schedule, never publish on the spot.\n");
fs.writeFileSync(path.join(root, "social", "reels", "AGENTS.md"), "Reels rule: first comment always.\n");
fs.writeFileSync(path.join(root, "social", "reels", "node_modules", "x", "AGENTS.md"), "vendored\n");
fs.writeFileSync(path.join(root, "social", "reels", "clip.txt"), "clip\n");
fs.writeFileSync(
  path.join(root, ".apc", "memory.md"),
  "# Northwind memory\n\n## Rules\n- Posts go out at 18:00 local.\n\n## 2026-09-20\n- a log line that belongs to retrieval\n"
);

const projects = new ProjectManager({ engines: {} });
projects.register(root);
const entry = projects.list().find((p) => p.path === root);

after(() => {
  cleanupTempProject(root);
  fs.rmSync(TMP_HOME, { recursive: true, force: true });
});

test("a project is recognised by name, accents and spacing aside", () => {
  assert.equal(ctx.projectNamedIn("revisá lo de northwind media mañana", projects)?.id, entry.id);
  assert.equal(ctx.projectNamedIn("lo de NorthWindMedia", projects)?.id, entry.id, "written together");
  assert.equal(ctx.projectNamedIn("nothing here about it", projects), null);
  assert.equal(ctx.projectNamedIn("the default project", projects), null, "default is never 'named'");
});

test("resolution order: pinned surface, then this message, then the recent thread", () => {
  assert.equal(ctx.resolveTurnProject({ prompt: "hola", projects, channelMeta: { projectPath: root } })?.reason, "pinned");
  assert.equal(ctx.resolveTurnProject({ prompt: "publicá lo de northwind media", projects })?.reason, "named");
  const thread = ctx.resolveTurnProject({
    prompt: "dale, hacelo",
    projects,
    previousMessages: [{ role: "user", content: "mirá northwind media" }, { role: "assistant", content: "ok" }],
  });
  assert.equal(thread?.reason, "thread");
  assert.equal(ctx.resolveTurnProject({ prompt: "dale", projects, previousMessages: [{ role: "assistant", content: "northwind media" }] }), null,
    "the model's own words do not pick the project");
});

test("nested AGENTS.md are found, vendored trees are not", () => {
  assert.deepEqual(ctx.listNestedAgentsFiles(root), [path.join("social", "AGENTS.md"), path.join("social", "reels", "AGENTS.md")]);
});

test("memory core keeps the durable top and leaves the dated log to retrieval", () => {
  const core = ctx.memoryCore(fs.readFileSync(path.join(root, ".apc", "memory.md"), "utf8"));
  assert.match(core, /18:00/);
  assert.doesNotMatch(core, /belongs to retrieval/);
});

test("the situation block names the lead, the MCPs, the folder rules and the memory", () => {
  const mcp = { name: "social-api", url: "https://mcp.example.com/social", source: "runtime", enabled: true, description: "Schedules social posts" };
  recordMcpTools(mcp, [{ name: "list_posts", description: "List posts." }, { name: "create_post_draft", description: "Draft a post." }]);
  const registries = { for: () => ({ list: () => [mcp, { name: "off", enabled: false, source: "global" }] }) };
  const resolved = ctx.resolveTurnProject({ prompt: "northwind media", projects });
  const block = ctx.buildSituationBlock({ resolved, registries });
  assert.match(block, /This turn's project: Northwind Media/);
  assert.match(block, /`lead` \(lead\)/);
  assert.match(block, /start with `lead`/);
  assert.match(block, /`social-api` — Schedules social posts · tools: list_posts, create_post_draft/);
  assert.doesNotMatch(block, /`off`/, "disabled servers are not offered");
  assert.match(block, /Root rule: every post is reviewed/);
  assert.match(block, /social\/reels\/AGENTS\.md/);
  assert.match(block, /Posts go out at 18:00/);
  assert.match(describeMcpLine({ name: "never-listed" }), /list_mcp_tools/);
});

test("touching a folder attaches its rules once, root-most first, ahead of the result", () => {
  const seen = new Set();
  const toolCtx = { projects };
  const first = attachDirectoryRules({
    name: "read_file", args: { project: String(entry.id), path: "social/reels/clip.txt" }, result: { content: "clip" }, ctx: toolCtx, seen,
  });
  assert.equal(Object.keys(first)[0], "folder_rules");
  assert.deepEqual(first.folder_rules.files.map((f) => f.path), [path.join("social", "AGENTS.md"), path.join("social", "reels", "AGENTS.md")]);
  const again = attachDirectoryRules({
    name: "list_files", args: { path: path.join(root, "social") }, result: { files: [] }, ctx: toolCtx, seen,
  });
  assert.equal(again.folder_rules, undefined, "already shown this turn");
  const outside = attachDirectoryRules({ name: "read_file", args: { path: "README.md" }, result: { content: "" }, ctx: toolCtx, seen: new Set() });
  assert.equal(outside.folder_rules, undefined, "the default project has no folder rules to show");
});

const cfg = {
  super_agent: {
    enabled: true, model: "mock:router", permission_mode: "total",
    model_fallback: { enabled: false }, stuck_detection: { enabled: false }, judge: { enabled: false },
  },
  memory: { enabled: false },
  engines: {},
};

test("the super-agent's prompt carries the project the owner named", async () => {
  const r = await runSuperAgent({
    projects, plugins: null, registries: null, globalConfig: cfg, channel: CHANNELS.TELEGRAM,
    prompt: "[mock:system] agendá lo de northwind media",
  });
  assert.match(r.text, /This turn's project: Northwind Media/);
  assert.match(r.text, /Social rule|social\/AGENTS\.md/);
  assert.match(r.text, /lead `lead`/, "the project index names each project's lead");
});

test("a project agent's prompt carries its project's AGENTS.md", () => {
  const project = ctx.resolveTurnProject({ prompt: "northwind media", projects }).project;
  const agent = { slug: "editor", fields: { Role: "Edits reels" }, body: "You edit." };
  const system = buildAgentSystem(project, agent, { globalConfig: cfg, channel: CHANNELS.WEB });
  assert.match(system, /Root rule: every post is reviewed/);
  assert.match(system, /social\/reels\/AGENTS\.md/);
});

test("the agent loop hands the model a folder's rules with the first result from it", async () => {
  const { runAgent } = await import("#core/agent/run-agent.js");
  const { createToolSession } = await import("#core/agent/tools/registry.js");
  const session = createToolSession("web");
  const args = JSON.stringify({ project: String(entry.id), path: "social/reels/clip.txt" });
  const r = await runAgent({
    globalConfig: cfg, system: "sys",
    prompt: `[mock:tool:read_file] [mock:args:${args}] [mock:lasttool] leé el clip`,
    toolSchemas: session.initialSchemas,
    makeToolHandlers: () => ({ read_file: async () => ({ content: "clip" }) }),
    toolHandlerCtx: { toolSession: session, globalConfig: cfg, projects },
    maxIters: 4,
  });
  assert.match(r.text, /folder_rules/, "the rules rode along");
  assert.match(r.text, /schedule, never publish/, "the model gets the full text of the rules");
});

// The trace is what gets persisted and replayed: if it cannot say which rules
// were delivered, a reviewer cannot tell "never knew" from "knew and ignored".
test("the trace names every rules file it delivered, even when the result is clipped", async () => {
  const { createHash } = await import("node:crypto");
  const { runAgent } = await import("#core/agent/run-agent.js");
  const { createToolSession } = await import("#core/agent/tools/registry.js");
  const session = createToolSession("web");
  const args = JSON.stringify({ project: String(entry.id), path: "social/reels/clip.txt" });
  const r = await runAgent({
    globalConfig: cfg, system: "sys",
    prompt: `[mock:tool:read_file] [mock:args:${args}] leé el clip`,
    toolSchemas: session.initialSchemas,
    // Big enough that the trace summarizer has to clip the result.
    makeToolHandlers: () => ({ read_file: async () => ({ content: "x".repeat(5000) }) }),
    toolHandlerCtx: { toolSession: session, globalConfig: cfg, projects },
    maxIters: 2,
  });
  const recorded = r.trace.find((t) => t.tool === "read_file").result.folder_rules;
  assert.equal(recorded.length, 2);
  const social = "Social rule: schedule, never publish on the spot.";
  const sha = createHash("sha256").update(social).digest("hex").slice(0, 12);
  assert.equal(recorded[0], `${path.join("social", "AGENTS.md")} · ${Buffer.byteLength(social)} bytes · sha256:${sha}`);
  assert.match(recorded[1], new RegExp(`^${path.join("social", "reels", "AGENTS.md").replace(/[\\.]/g, "\\$&")} · \\d+ bytes · sha256:[0-9a-f]{12}$`));
  assert.doesNotMatch(JSON.stringify(recorded), /nested|schedule, never publish/, "a pointer, not the text");
});

test("listing a server's tools through the registry fills the catalog", async () => {
  const { McpRegistry } = await import("#core/mcp/runner.js");
  const { cachedMcpTools } = await import("#core/mcp/catalog.js");
  const reg = new McpRegistry(root);
  const meta = { name: "fake-social", url: "https://mcp.example.com/fake", transport: "http", enabled: true };
  reg.getByName = () => meta;
  reg._ensureProcess = () => ({ listTools: async () => ({ tools: [{ name: "list_posts", description: "List posts." }] }) });
  const out = await reg.listTools("fake-social");
  assert.equal(out.tools.length, 1, "the caller still gets the paged { tools } shape");
  assert.deepEqual(cachedMcpTools(meta).tools.map((t) => t.name), ["list_posts"]);
});

test("project recall never runs for the default project or with memory off", async () => {
  const { projectRecallBlock } = await import("#core/memory/index.js");
  assert.equal(await projectRecallBlock("hola", { project: { id: 0, name: "default" }, config: cfg }), "");
  assert.equal(await projectRecallBlock("hola", { project: { id: entry.id, name: "Northwind Media" }, config: cfg }), "");
});
