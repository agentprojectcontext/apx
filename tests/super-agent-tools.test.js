import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { ProjectManager } from "../src/daemon/db.js";
import { makeToolHandlers, TOOL_SCHEMAS } from "../src/daemon/super-agent-tools.js";
import { makeTempProject, cleanupTempProject } from "./_helpers.js";

function setup() {
  const root = makeTempProject({
    name: "Test Project",
    agents: [
      { slug: "sofia", role: "Support", model: "mock:test", language: "es-AR", skills: ["customer-support"] },
      { slug: "martin", role: "Sales", model: "mock:test" },
    ],
    skills: [{ name: "customer-support", body: "# customer-support\n\nbe nice." }],
    mcps: {
      filesystem: { command: "true", args: [], enabled: true },
    },
  });
  const projects = new ProjectManager({ engines: {} });
  projects.register(root);
  return { root, projects };
}

test("TOOL_SCHEMAS exposes the expected functions", () => {
  const names = TOOL_SCHEMAS.map((t) => t.function.name);
  for (const expected of [
    "list_projects", "list_agents", "list_vault_agents", "import_agent",
    "add_project", "list_mcps", "read_agent_memory", "list_files", "read_file",
    "write_file", "edit_file", "run_shell",
    "tail_messages", "search_messages",
    "call_agent", "call_mcp", "call_runtime", "send_telegram",
    "set_identity", "set_permission_mode",
  ]) {
    assert.ok(names.includes(expected), `missing tool: ${expected}`);
  }
});

test("call_runtime schema allows APX runtime without an explicit agent", () => {
  const schema = TOOL_SCHEMAS.find((t) => t.function.name === "call_runtime");
  assert.ok(schema);
  assert.deepEqual(schema.function.parameters.required.sort(), ["prompt", "runtime"]);
  assert.match(schema.function.parameters.properties.agent.description, /vos mismo/);
  assert.deepEqual(schema.function.parameters.properties.runtime.enum, [
    "claude-code",
    "codex",
    "opencode",
    "aider",
    "cursor-agent",
    "gemini-cli",
    "qwen-code",
  ]);
});

test("call_runtime reports missing runtime before creating a blank run", async () => {
  const { root, projects } = setup();
  const oldPath = process.env.PATH;
  process.env.PATH = "";
  try {
    const handlers = makeToolHandlers({
      projects,
      plugins: null,
      registries: null,
      globalConfig: { super_agent: { permission_mode: "total" } },
    });
    const r = await handlers.call_runtime({
      runtime: "aider",
      prompt: "test",
    });
    assert.match(r.error, /runtime "aider" is not installed or not runnable/);
    assert.equal(r.runtime, "aider");
    assert.equal(r.binary, "aider");
    assert.deepEqual(r.installed_runtimes, []);
  } finally {
    process.env.PATH = oldPath;
    cleanupTempProject(root);
  }
});

test("list_projects returns the registered project", () => {
  const { root, projects } = setup();
  try {
    const handlers = makeToolHandlers({ projects, plugins: null, registries: null, globalConfig: {} });
    const r = handlers.list_projects();
    assert.equal(r.length, 1);
    assert.equal(r[0].path, root);
    assert.equal(r[0].name, "Test Project");
  } finally {
    cleanupTempProject(root);
  }
});

test("list_agents without project returns grouped inventory", () => {
  const { root, projects } = setup();
  try {
    const handlers = makeToolHandlers({ projects, plugins: null, registries: null, globalConfig: {} });
    const r = handlers.list_agents({});
    assert.equal(r.length, 1);
    assert.equal(r[0].project.name, "Test Project");
    assert.deepEqual(r[0].agents.map((a) => a.slug).sort(), ["martin", "sofia"]);
  } finally {
    cleanupTempProject(root);
  }
});

test("list_agents returns the agents from AGENTS.md", () => {
  const { root, projects } = setup();
  try {
    const handlers = makeToolHandlers({ projects, plugins: null, registries: null, globalConfig: {} });
    const r = handlers.list_agents({ project: "Test Project" });
    const slugs = r.map((a) => a.slug).sort();
    assert.deepEqual(slugs, ["martin", "sofia"]);
    const sofia = r.find((a) => a.slug === "sofia");
    assert.equal(sofia.role, "Support");
    assert.equal(sofia.language, "es-AR");
    assert.deepEqual(sofia.skills, ["customer-support"]);
  } finally {
    cleanupTempProject(root);
  }
});

test("list_agents WITHOUT project + multiple projects → returns grouped list", async () => {
  const { ProjectManager } = await import("../src/daemon/db.js");
  const root1 = makeTempProject({ name: "P1", agents: [{ slug: "a1" }] });
  const root2 = makeTempProject({ name: "P2", agents: [{ slug: "b1" }, { slug: "b2" }] });
  const projects = new ProjectManager({ engines: {} });
  projects.register(root1);
  projects.register(root2);
  try {
    const handlers = makeToolHandlers({ projects, plugins: null, registries: null, globalConfig: {} });
    const r = handlers.list_agents();
    assert.ok(Array.isArray(r));
    assert.equal(r.length, 2, "should return one entry per project");
    for (const entry of r) {
      assert.ok(entry.project, "each entry has a project block");
      assert.ok(Array.isArray(entry.agents), "each entry has an agents array");
    }
    const allSlugs = r.flatMap((e) => e.agents.map((a) => a.slug)).sort();
    assert.deepEqual(allSlugs, ["a1", "b1", "b2"]);
  } finally {
    cleanupTempProject(root1);
    cleanupTempProject(root2);
  }
});

test("list_mcps WITHOUT project + multiple projects → returns grouped list", async () => {
  const { ProjectManager } = await import("../src/daemon/db.js");
  const root1 = makeTempProject({
    name: "P1", agents: [{ slug: "a1" }],
    mcps: { fs1: { command: "true", enabled: true } },
  });
  const root2 = makeTempProject({
    name: "P2", agents: [{ slug: "b1" }],
    mcps: { fs2: { command: "true", enabled: true } },
  });
  const projects = new ProjectManager({ engines: {} });
  projects.register(root1);
  projects.register(root2);
  try {
    const registries = {
      for: (p) => ({
        list: () => {
          const m = p.path === root1 ? "fs1" : "fs2";
          return [{ name: m, source: "apc", enabled: true, command: "true" }];
        }
      })
    };
    const handlers = makeToolHandlers({ projects, plugins: null, registries, globalConfig: {} });
    const r = handlers.list_mcps();
    assert.equal(r.length, 2);
    const names = r.flatMap((e) => e.mcps.map((m) => m.name)).sort();
    assert.deepEqual(names, ["fs1", "fs2"]);
  } finally {
    cleanupTempProject(root1);
    cleanupTempProject(root2);
  }
});

test("list_mcps returns the MCP registry", () => {
  const { root, projects } = setup();
  try {
    const registries = {
      for: () => ({
        list: () => [{ name: "filesystem", source: "apc", enabled: true }]
      })
    };
    const handlers = makeToolHandlers({ projects, plugins: null, registries, globalConfig: {} });
    const r = handlers.list_mcps({ project: "Test Project" });
    assert.equal(r.length, 1);
    assert.equal(r[0].name, "filesystem");
    assert.equal(r[0].source, "apc");
    assert.equal(r[0].enabled, true);
  } finally {
    cleanupTempProject(root);
  }
});

test("read_agent_memory reads the agent's memory.md", () => {
  const { root, projects } = setup();
  try {
    const handlers = makeToolHandlers({ projects, plugins: null, registries: null, globalConfig: {} });
    const r = handlers.read_agent_memory({ agent: "sofia" });
    assert.match(r.body, /Memory — sofia/);
  } finally {
    cleanupTempProject(root);
  }
});

test("list_files refuses path traversal outside the project root", () => {
  const { root, projects } = setup();
  try {
    const handlers = makeToolHandlers({ projects, plugins: null, registries: null, globalConfig: {} });
    assert.throws(
      () => handlers.list_files({ path: "../../../../etc" }),
      /escapes the project root/
    );
  } finally {
    cleanupTempProject(root);
  }
});

test("read_file refuses path traversal", () => {
  const { root, projects } = setup();
  try {
    const handlers = makeToolHandlers({ projects, plugins: null, registries: null, globalConfig: {} });
    assert.throws(
      () => handlers.read_file({ path: "/etc/passwd" }),
      /escapes the project root/
    );
  } finally {
    cleanupTempProject(root);
  }
});

test("write_file requires confirmation in automatico mode", () => {
  const { root, projects } = setup();
  try {
    const handlers = makeToolHandlers({
      projects,
      plugins: null,
      registries: null,
      globalConfig: { super_agent: { permission_mode: "automatico" } },
    });
    assert.throws(
      () => handlers.write_file({ path: "x.txt", content: "hello" }),
      /requires_confirmation/
    );
    const r = handlers.write_file({ path: "x.txt", content: "hello", confirmed: true });
    assert.equal(r.ok, true);
  } finally {
    cleanupTempProject(root);
  }
});

test("run_shell executes in selected project when confirmed", async () => {
  const { root, projects } = setup();
  try {
    const handlers = makeToolHandlers({
      projects,
      plugins: null,
      registries: null,
      globalConfig: { super_agent: { permission_mode: "automatico" } },
    });
    const r = await handlers.run_shell({ command: "pwd", confirmed: true });
    assert.equal(r.exit_code, 0);
    assert.equal(fs.realpathSync(r.stdout.trim()), fs.realpathSync(root));
  } finally {
    cleanupTempProject(root);
  }
});

test("run_shell allows safe read-only commands in automatico mode", async () => {
  const { root, projects } = setup();
  try {
    const handlers = makeToolHandlers({
      projects,
      plugins: null,
      registries: null,
      globalConfig: { super_agent: { permission_mode: "automatico" } },
    });
    const r = await handlers.run_shell({ command: "pwd" });
    assert.equal(r.exit_code, 0);
    assert.equal(fs.realpathSync(r.stdout.trim()), fs.realpathSync(root));
  } finally {
    cleanupTempProject(root);
  }
});

test("tail_messages handles empty project gracefully", () => {
  const { root, projects } = setup();
  try {
    const handlers = makeToolHandlers({ projects, plugins: null, registries: null, globalConfig: {} });
    const r = handlers.tail_messages({});
    assert.deepEqual(r, []);
  } finally {
    cleanupTempProject(root);
  }
});
