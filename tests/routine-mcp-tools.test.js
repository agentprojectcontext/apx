// The two capabilities the super-agent had to fake with `run_shell`:
//   - running a routine (it shelled out to `apx routine run`, or rewrote
//     routines.json with python heredocs),
//   - learning an MCP server's contract (it read the server's PHP source).
// Both are tools now; these pin their contracts.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-routine-tools-"));
process.env.HOME = TMP_HOME;
process.env.USERPROFILE = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx"); // isolate the apx home too — HOME alone is overridden by the runner's APX_HOME

const { test } = await import("node:test");
const { default: assert } = await import("node:assert/strict");
const { default: runRoutine } = await import("#core/agent/tools/handlers/run-routine.js");
const { default: listRoutinesTool } = await import("#core/agent/tools/handlers/list-routines.js");
const { default: listMcpTools } = await import("#core/agent/tools/handlers/list-mcp-tools.js");
const { upsertRoutine } = await import("#core/stores/routines.js");
const { makeTempProject, cleanupTempProject } = await import("./_helpers.js");

function writeAgent(root, slug, extraFm = "") {
  const dir = path.join(root, ".apc", "agents");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${slug}.md`),
    `---\nname: ${slug}\nmodel: mock:test\ndescription: Test agent.\n${extraFm}---\n\n# ${slug}\nWork.\n`,
  );
}

function makeCtx(root, name = "acme") {
  const storagePath = path.join(TMP_HOME, ".apx", "projects", name);
  fs.mkdirSync(storagePath, { recursive: true });
  const project = { id: 1, name, path: root, storagePath, config: null, logMessage: () => {} };
  return {
    project,
    projects: { list: () => [{ id: 1, name, path: root }], get: () => project },
    plugins: { get: () => null },
    registries: null,
    globalConfig: { super_agent: { enabled: true, model: "mock:test", permission_mode: "total" } },
    requirePermission: async () => {},
  };
}

test("run_routine runs the routine and reports a verdict, not a transcript", async () => {
  const root = makeTempProject({ name: "acme", agents: [{ slug: "magui", model: "mock:test" }] });
  writeAgent(root, "magui", "tools: read_file\n");
  const ctx = makeCtx(root);
  try {
    upsertRoutine(ctx.project.storagePath, {
      name: "magui-ideas",
      kind: "exec_agent",
      schedule: "every:24h",
      spec: { agent: "magui", prompt: "Generá ideas [mock:tool:read_file]" },
    });

    const out = await runRoutine.makeHandler(ctx)({ routine: "magui-ideas" });
    assert.equal(out.status, "ok");
    assert.equal(out.routine, "magui-ideas");
    // The routine ran with tools even though nobody passed allowed_tools.
    assert.equal(out.tools_used.total, 1);
    assert.equal(out.tools_used.tools[0].name, "read_file");
    assert.ok(out.last_run_at, "the run is recorded, so the next call sees it");
    // Counts, not arguments: the verdict must not carry the whole trace.
    assert.equal(out.trace, undefined);
  } finally {
    cleanupTempProject(root);
  }
});

test("run_routine on an unknown name answers with the real ones", async () => {
  const root = makeTempProject({ name: "acme2", agents: [] });
  const ctx = makeCtx(root, "acme2");
  try {
    upsertRoutine(ctx.project.storagePath, {
      name: "magui-postero",
      kind: "heartbeat",
      schedule: "every:24h",
      spec: {},
    });
    const out = await runRoutine.makeHandler(ctx)({ routine: "magui-postro" });
    assert.match(out.error, /not found/);
    assert.deepEqual(out.available, ["magui-postero"]);
  } finally {
    cleanupTempProject(root);
  }
});

test("list_routines says 'agent default' rather than printing an empty allowlist", async () => {
  const root = makeTempProject({ name: "acme3", agents: [] });
  const ctx = makeCtx(root, "acme3");
  try {
    upsertRoutine(ctx.project.storagePath, {
      name: "sin-tools", kind: "heartbeat", schedule: "0 8 * * *", spec: {},
    });
    upsertRoutine(ctx.project.storagePath, {
      name: "con-tools", kind: "heartbeat", schedule: "0 9 * * *", spec: {},
      allowed_tools: ["read_file", "run_shell"],
    });
    const out = await listRoutinesTool.makeHandler(ctx)({});
    const byName = Object.fromEntries(out.routines.map((r) => [r.name, r]));
    assert.equal(byName["sin-tools"].tools, "agent default");
    assert.equal(byName["con-tools"].tools, 2);
  } finally {
    cleanupTempProject(root);
  }
});

test("list_mcp_tools returns names + args, and names the real servers on a typo", async () => {
  const root = makeTempProject({ name: "acme4", agents: [] });
  const ctx = makeCtx(root, "acme4");
  const registry = {
    list: () => [{ name: "postbean" }],
    listTools: async (name) => {
      assert.equal(name, "postbean");
      return {
        tools: [
          {
            name: "upload_media",
            description: "Upload a media file to the workspace.\nAccepts a URL or base64.",
            inputSchema: { type: "object", properties: { url: {}, mime_type: {} }, required: ["url"] },
          },
        ],
      };
    },
  };
  ctx.registries = { for: () => registry, ensure: () => registry };
  try {
    const brief = await listMcpTools.makeHandler(ctx)({ mcp: "postbean" });
    assert.equal(brief.count, 1);
    assert.deepEqual(brief.tools[0], {
      name: "upload_media",
      description: "Upload a media file to the workspace. Accepts a URL or base64.",
      args: ["url", "mime_type"],
      required: ["url"],
    });

    const full = await listMcpTools.makeHandler(ctx)({ mcp: "postbean", detail: "full" });
    assert.ok(full.tools[0].inputSchema, "full detail keeps the JSON Schema");

    const typo = await listMcpTools.makeHandler(ctx)({ mcp: "postbeam" });
    assert.match(typo.error, /not registered/);
    assert.deepEqual(typo.available, ["postbean"]);
  } finally {
    cleanupTempProject(root);
  }
});

test.after(() => {
  fs.rmSync(TMP_HOME, { recursive: true, force: true });
});
