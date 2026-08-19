// exec_agent routines must run the project agent's tool loop and persist a
// conversation — otherwise a Magui-style cron dumps DSML tool markup as the
// "answer", nothing on disk gets read, and the chat list stays empty.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-exec-agent-routine-"));
process.env.HOME = TMP_HOME;
process.env.USERPROFILE = TMP_HOME;

const { test } = await import("node:test");
const { default: assert } = await import("node:assert/strict");
const { runRoutineNow } = await import("#core/routines/runner.js");
const { listConversations, readConversation } = await import("#core/stores/conversations.js");
const { makeTempProject, cleanupTempProject } = await import("./_helpers.js");

function writeAgent(root, slug, extraFm = "") {
  const dir = path.join(root, ".apc", "agents");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${slug}.md`),
    `---\nname: ${slug}\nmodel: mock:test\ndescription: Test project agent.\n${extraFm}---\n\n# ${slug}\nDo the work.\n`,
  );
}

function makeCtx(root) {
  const storagePath = path.join(TMP_HOME, ".apx", "projects", "acme");
  fs.mkdirSync(storagePath, { recursive: true });
  const project = {
    id: 1,
    name: "acme",
    path: root,
    storagePath,
    config: {
      super_agent: { enabled: true, model: "mock:test", permission_mode: "total" },
    },
    logMessage: () => {},
  };
  return {
    project,
    projects: { list: () => [project], get: () => project },
    plugins: { get: () => null },
    registries: null,
    globalConfig: {
      super_agent: { enabled: true, model: "mock:test", permission_mode: "total" },
    },
  };
}

test("exec_agent with tools runs the call and stores a conversation", async () => {
  const root = makeTempProject({ name: "acme", agents: [{ slug: "scout", model: "mock:test" }] });
  writeAgent(root, "scout");
  fs.writeFileSync(path.join(root, "notes.md"), "hello from disk\n");
  const ctx = makeCtx(root);
  try {
    const out = await runRoutineNow(ctx, {
      name: "scout-morning",
      kind: "exec_agent",
      schedule: "every:24h",
      spec: { agent: "scout", prompt: "Look around [mock:tool:list_projects]" },
    });
    assert.equal(out.status, "ok");
    assert.equal(out.agent_slug, "scout");
    assert.ok(out.conversation_id, "run must persist a conversation id");
    assert.ok(Array.isArray(out.trace) && out.trace.some((t) => t.tool === "list_projects"),
      `expected list_projects in trace, got ${JSON.stringify(out.trace)}`);
    assert.ok(out.allowed_tools.includes("list_projects"), "empty tools: field falls back to defaults");
    assert.equal(out.allowed_tools.includes("send_telegram"), false, "must not inherit super-agent tools");
    assert.equal(out.allowed_tools.includes("call_runtime"), false);

    const convs = listConversations(ctx.project.storagePath, "scout");
    assert.equal(convs.length, 1);
    assert.equal(convs[0].channel, "routine");
    assert.equal(convs[0].title, "scout-morning");

    const detail = readConversation(ctx.project.storagePath, "scout", out.conversation_id);
    assert.ok(detail.turns.some((t) => t.role === "user"));
    assert.ok(detail.turns.some((t) => t.role === "tool"));
    assert.ok(detail.turns.some((t) => t.role === "assistant"));
  } finally {
    cleanupTempProject(root);
  }
});

test("exec_agent spec.no_tools stays a one-shot text call", async () => {
  const root = makeTempProject({ name: "acme", agents: [{ slug: "scout", model: "mock:test" }] });
  writeAgent(root, "scout");
  const ctx = makeCtx(root);
  try {
    const out = await runRoutineNow(ctx, {
      name: "scout-blurb",
      kind: "exec_agent",
      schedule: "every:24h",
      spec: { agent: "scout", no_tools: true, prompt: "One sentence [mock:tool:list_projects]" },
    });
    assert.equal(out.status, "ok");
    assert.equal(out.trace.length, 0, "no-tools path must not execute tools");
    assert.match(out.reply || "", /received:/);
    assert.ok(out.conversation_id);
    assert.deepEqual(out.allowed_tools, []);
  } finally {
    cleanupTempProject(root);
  }
});

// `allowed_tools: []` is what the store writes when nobody chose any — it is
// "no override", not "no tools". Reading it as an opt-out silently turned every
// routine created without --allowed-tools into a model narrating work it could
// not do (see the runner's noTools comment).
test("exec_agent allowed_tools:[] means no override, NOT a tool-less run", async () => {
  const root = makeTempProject({ name: "acme", agents: [{ slug: "scout", model: "mock:test" }] });
  writeAgent(root, "scout", "tools: read_file\n");
  const ctx = makeCtx(root);
  try {
    const out = await runRoutineNow(ctx, {
      name: "scout-default-tools",
      kind: "exec_agent",
      schedule: "every:24h",
      allowed_tools: [],
      spec: { agent: "scout", prompt: "Just look [mock:tool:read_file]" },
    });
    assert.equal(out.status, "ok");
    assert.deepEqual(out.allowed_tools, ["read_file"], "falls back to the agent's declared tools");
    assert.ok(out.trace.length > 0, "the tool loop actually ran");
  } finally {
    cleanupTempProject(root);
  }
});

test("exec_agent honor agent's tools: allowlist, not the full registry", async () => {
  const root = makeTempProject({ name: "acme", agents: [{ slug: "scout", model: "mock:test" }] });
  writeAgent(root, "scout", "tools: read_file\n");
  const ctx = makeCtx(root);
  try {
    const out = await runRoutineNow(ctx, {
      name: "scout-narrow",
      kind: "exec_agent",
      schedule: "every:24h",
      spec: { agent: "scout", prompt: "Just look [mock:tool:read_file]" },
    });
    assert.equal(out.status, "ok");
    assert.deepEqual(out.allowed_tools, ["read_file"]);
    assert.equal(out.allowed_tools.includes("send_telegram"), false);
    assert.equal(out.allowed_tools.includes("list_projects"), false);
  } finally {
    cleanupTempProject(root);
  }
});
