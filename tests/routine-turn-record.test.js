// A scheduled run is the one turn nobody watched stream: what it stored IS the
// record. It used to store the text and throw the rest away — the conversation
// opened with "0 tok", no model, no actor, while the very same run's ledger row
// had all three. That happened because routines had their own pair of writers.
// These pin the fix: one recorder, and a conversation file that carries what a
// ledger row carries.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-routine-turn-record-"));
process.env.HOME = TMP_HOME;
process.env.USERPROFILE = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx"); // isolate the apx home too — HOME alone is overridden by the runner's APX_HOME

const { test } = await import("node:test");
const { default: assert } = await import("node:assert/strict");
const { runRoutineNow } = await import("#core/routines/runner.js");
const {
  readConversation,
  shapeConversationMessage,
  parseConversation,
  startConversation,
  appendTurn,
} = await import("#core/stores/conversations.js");
const { makeTempProject, cleanupTempProject } = await import("./_helpers.js");

const RUNNER_SRC = fs.readFileSync(
  path.join(import.meta.dirname, "..", "src", "core", "routines", "runner.js"),
  "utf8",
);

function writeAgent(root, slug) {
  const dir = path.join(root, ".apc", "agents");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${slug}.md`),
    `---\nname: ${slug}\nmodel: mock:test\ndescription: Test project agent.\n---\n\n# ${slug}\nDo the work.\n`,
  );
}

function makeCtx(root, rows) {
  const storagePath = path.join(TMP_HOME, ".apx", "projects", `acme-${rows.length}-${Math.random()}`);
  fs.mkdirSync(storagePath, { recursive: true });
  const project = {
    id: 1,
    name: "acme",
    path: root,
    storagePath,
    config: { super_agent: { enabled: true, model: "mock:test", permission_mode: "total" } },
    logMessage: (row) => rows.push(row),
  };
  return {
    project,
    projects: { list: () => [project], get: () => project },
    plugins: { get: () => null },
    registries: null,
    globalConfig: { super_agent: { enabled: true, model: "mock:test", permission_mode: "total" } },
  };
}

test("a routine's stored conversation carries what the run cost", async () => {
  const root = makeTempProject({ name: "acme", agents: [{ slug: "scout", model: "mock:test" }] });
  writeAgent(root, "scout");
  const rows = [];
  const ctx = makeCtx(root, rows);
  try {
    const out = await runRoutineNow(ctx, {
      name: "scout-nightly",
      kind: "exec_agent",
      schedule: "every:24h",
      spec: { agent: "scout", prompt: "Look around [mock:tool:list_projects]" },
    });
    assert.equal(out.status, "ok");

    const conv = readConversation(ctx.project.storagePath, "scout", out.conversation_id);
    const reply = conv.turns.find((t) => t.role === "assistant");
    assert.ok(reply, "the run must file its answer");
    assert.ok(reply.meta, "the answer must carry its attribution, not just its text");
    assert.equal(reply.meta.agent, "scout");
    assert.equal(reply.meta.model, "mock:test");
    assert.ok(
      reply.meta.usage?.input_tokens > 0 || reply.meta.usage?.output_tokens > 0,
      `a run that called a model spent tokens, got ${JSON.stringify(reply.meta.usage)}`,
    );
    // What the turn DID, recorded compactly — the live tool events are gone by
    // the time anyone opens the thread.
    assert.ok(reply.meta.tool_summary?.total > 0, "the tool summary must survive the run");

    // The viewer reads a file thread and a ledger thread through one shaper, so
    // the field names have to be the ledger's (readGlobalThread).
    const shaped = shapeConversationMessage(reply);
    assert.equal(shaped.model, "mock:test");
    assert.equal(shaped.agent, "scout");
    // The per-actor breakdown shows the name; without one it renders "—".
    assert.equal(shaped.agent_name, "scout");
    assert.deepEqual(shaped.usage, reply.meta.usage);
  } finally {
    cleanupTempProject(root);
  }
});

test("the ledger row and the conversation turn agree on the same run", async () => {
  const root = makeTempProject({ name: "acme", agents: [{ slug: "scout", model: "mock:test" }] });
  writeAgent(root, "scout");
  const rows = [];
  const ctx = makeCtx(root, rows);
  try {
    const out = await runRoutineNow(ctx, {
      name: "scout-nightly",
      kind: "exec_agent",
      schedule: "every:24h",
      spec: { agent: "scout", prompt: "Look around [mock:tool:list_projects]" },
    });
    const agentRow = rows.find((r) => r.type === "agent");
    assert.ok(agentRow, "the ledger still gets its row");
    assert.equal(agentRow.meta.routine, "scout-nightly");
    assert.equal(agentRow.meta.conversation, out.conversation_id);
    assert.equal(agentRow.meta.model, "mock:test");

    const conv = readConversation(ctx.project.storagePath, "scout", out.conversation_id);
    const reply = conv.turns.find((t) => t.role === "assistant");
    assert.deepEqual(
      reply.meta.usage,
      agentRow.meta.usage,
      "one recorder means the two halves cannot disagree about the cost",
    );

    // The prompt reaches BOTH halves: the ledger keeps the words (search matches
    // them), the thread says whose clock woke it.
    assert.ok(rows.some((r) => r.type === "user"), "the ledger records what was asked");
    const asked = conv.turns.find((t) => t.role === "user");
    assert.match(asked.content, /^\[routine: scout-nightly\]/);
  } finally {
    cleanupTempProject(root);
  }
});

test("routines have no private conversation writer left", () => {
  // The bug was structural, not a missing field: a second writer that nobody
  // updated when the first one learned to record attribution.
  assert.equal(
    /function persistRoutineConversation|function logRoutineChat/.test(RUNNER_SRC),
    false,
    "the runner must file turns through recordAgentTurn, not its own pair",
  );
  assert.match(RUNNER_SRC, /recordAgentTurn/, "…and it must actually call the shared one");
});

test("a turn header without attribution still parses (files written before this)", () => {
  const storagePath = path.join(TMP_HOME, ".apx", "projects", "legacy");
  fs.mkdirSync(storagePath, { recursive: true });
  const conv = startConversation({ storagePath, agentSlug: "old", engine: "mock:test" });
  // Exactly what appendTurn wrote before headers carried meta.
  fs.appendFileSync(conv.path, "## assistant — 2020-01-01T00:00:00Z\nplain answer\nsecond line\n\n");
  const { turns } = parseConversation(fs.readFileSync(conv.path, "utf8"));
  const reply = turns.find((t) => t.role === "assistant");
  assert.equal(reply.content, "plain answer\nsecond line");
  assert.equal(reply.meta, undefined);
  assert.equal(shapeConversationMessage(reply).usage, undefined);
});

test("a body that starts with a brace is a body, not attribution", () => {
  const storagePath = path.join(TMP_HOME, ".apx", "projects", "braces");
  fs.mkdirSync(storagePath, { recursive: true });
  const conv = startConversation({ storagePath, agentSlug: "old", engine: "mock:test" });
  appendTurn({
    filePath: conv.path,
    role: "assistant",
    content: '{"looks": "like meta"}\nbut it is the answer',
    meta: { model: "mock:test", usage: { input_tokens: 7, output_tokens: 3 } },
  });
  const { turns } = parseConversation(fs.readFileSync(conv.path, "utf8"));
  const reply = turns.find((t) => t.role === "assistant");
  assert.equal(reply.content, '{"looks": "like meta"}\nbut it is the answer');
  assert.equal(reply.meta.model, "mock:test");
  assert.deepEqual(reply.meta.usage, { input_tokens: 7, output_tokens: 3 });
});
