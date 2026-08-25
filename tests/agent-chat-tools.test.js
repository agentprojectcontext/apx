// A project agent's chat runs its tool loop.
//
// It did not. POST /agents/:slug/chat and .../exec called callEngine directly —
// one model call, no tool schemas, no loop — while runAgent, the loop, had
// exactly one caller in the whole repo: the routine runner. So an agent asked
// to browse replied with a fenced {"tool":"browser_navigate",…} as its FINAL
// ANSWER, because narrating the call was the only move it had. Rocky did
// exactly that on 2026-08-20; the same prompt on the super-agent ran fine.
//
// These boot the real register() over a live socket and drive it the way the
// panel and `apx exec -a` do.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import { apiRouter } from "./_helpers.js";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-agent-chat-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx"); // isolate the apx home too — HOME alone is overridden by the runner's APX_HOME

const { register: registerExec } = await import("../src/host/daemon/api/exec.js");

let server;
let call;
let PROJECT;

/** A project on disk with one agent card, plus the storage the ledger writes to. */
function makeProject({ slug = "magui", tools = null } = {}) {
  const root = fs.mkdtempSync(path.join(TMP_HOME, "proj-"));
  const storage = fs.mkdtempSync(path.join(TMP_HOME, "store-"));
  fs.mkdirSync(path.join(root, ".apc", "agents"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".apc", "project.json"),
    JSON.stringify({ name: "tmp", apx: "installed" })
  );
  const front = ["---", "Role: Tester", "Model: mock"];
  if (tools) front.push(`Tools: ${tools.join(", ")}`);
  front.push("---", "", "You are a test agent.");
  fs.writeFileSync(path.join(root, ".apc", "agents", `${slug}.md`), front.join("\n"));
  return { id: "1", name: "tmp", path: root, storagePath: storage, logMessage: () => {} };
}

before(async () => {
  PROJECT = makeProject();
  const projects = {
    list: () => [PROJECT],
    get: () => PROJECT,
    rebuild: () => {},
  };
  const project = (req, res) => {
    if (String(req.params.pid) !== "1") {
      res.status(404).json({ error: "project not found" });
      return null;
    }
    return PROJECT;
  };

  const app = express();
  app.use(express.json());
  const router = apiRouter(express, app);
  registerExec(router, {
    projects,
    project,
    config: { model: "mock", engines: {} },
    plugins: {},
    registries: null,
  });

  server = await new Promise((r) => {
    const s = app.listen(0, "127.0.0.1", () => r(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  call = async (p, body) => {
    const res = await fetch(base + p, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null, text };
  };
});

after(() => {
  server?.close();
  fs.rmSync(TMP_HOME, { recursive: true, force: true });
});

test("exec runs the tool loop — the agent CALLS the tool instead of describing it", async () => {
  const r = await call("/api/projects/1/agents/magui/exec", {
    prompt: "[mock:tool:list_agents] listame los agentes",
    model: "mock",
  });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body.trace), "the response carries a trace");
  assert.ok(r.body.trace.length > 0, "the loop ran at least one tool");
  assert.equal(r.body.trace[0].tool, "list_agents");
  // The regression in one line: the answer must not BE the tool call.
  assert.doesNotMatch(r.body.text, /"tool"\s*:\s*"list_agents"/);
});

test("chat runs the tool loop too, and keeps the conversation contract", async () => {
  const r = await call("/api/projects/1/agents/magui/chat", {
    prompt: "[mock:tool:list_agents] dale",
    model: "mock",
  });
  assert.equal(r.status, 200);
  assert.ok(r.body.conversation_id, "still returns the conversation it wrote to");
  assert.equal(r.body.trace[0].tool, "list_agents");
  assert.ok("usage" in r.body && "engine" in r.body, "the old response fields survive");
});

test("a second chat turn replays the first — history is not lost to the loop", async () => {
  const first = await call("/api/projects/1/agents/magui/chat", {
    prompt: "primero",
    model: "mock",
  });
  const second = await call("/api/projects/1/agents/magui/chat", {
    prompt: "[mock:system] segundo",
    model: "mock",
    conversation_id: first.body.conversation_id,
  });
  assert.equal(second.status, 200);
  assert.equal(second.body.conversation_id, first.body.conversation_id);
});

test("tools:false keeps the old toolless path for callers that want one model call", async () => {
  const r = await call("/api/projects/1/agents/magui/exec", {
    prompt: "[mock:tool:list_agents] no deberías poder",
    model: "mock",
    tools: false,
  });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.trace, [], "no loop, no trace");
  assert.deepEqual(r.body.allowed_tools, [], "and no allowlist was resolved");
});

test("the agent's declared allowlist is the gate, not a hint", async () => {
  // A card that declares `Tools:` is a deliberate narrowing — the endpoint must
  // honour it exactly, or the loop would hand a specialist the whole registry.
  const narrow = makeProject({ slug: "narrow", tools: ["read_file", "list_files"] });
  const app = express();
  app.use(express.json());
  const router = apiRouter(express, app);
  registerExec(router, {
    projects: { list: () => [narrow], get: () => narrow, rebuild: () => {} },
    project: () => narrow,
    config: { model: "mock", engines: {} },
    plugins: {},
    registries: null,
  });
  const s = await new Promise((r) => {
    const srv = app.listen(0, "127.0.0.1", () => r(srv));
  });
  try {
    const res = await fetch(
      `http://127.0.0.1:${s.address().port}/api/projects/1/agents/narrow/exec`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: "hola", model: "mock" }),
      }
    );
    const body = await res.json();
    assert.deepEqual(
      [...body.allowed_tools].sort(),
      ["list_files", "read_file"],
      "exactly what the card declared"
    );
  } finally {
    s.close();
  }
});

test("a missing agent and a missing conversation still answer with their own status", async () => {
  const noAgent = await call("/api/projects/1/agents/nobody/exec", { prompt: "x", model: "mock" });
  assert.equal(noAgent.status, 404);
  const noConv = await call("/api/projects/1/agents/magui/chat", {
    prompt: "x",
    model: "mock",
    conversation_id: "2020-01-01-99",
  });
  assert.equal(noConv.status, 404);
  assert.match(noConv.body.error, /conversation/);
});

test("chat persists tool rows and tool_summary for a reopened thread", async () => {
  const r = await call("/api/projects/1/agents/magui/chat", {
    prompt: "[mock:tool:list_agents] dale",
    model: "mock",
  });
  assert.equal(r.status, 200);
  const { readConversation, shapeConversationMessage } = await import("#core/stores/conversations.js");
  const conv = readConversation(PROJECT.storagePath, "magui", r.body.conversation_id);
  const tool = conv.turns.find((t) => t.role === "tool");
  assert.ok(tool, "the conversation file must keep what the agent did");
  assert.equal(JSON.parse(tool.content).tool, "list_agents");
  const reply = conv.turns.find((t) => t.role === "assistant");
  assert.ok(reply?.meta?.tool_summary?.total >= 1, "tool_summary must survive reopen");
  const shaped = shapeConversationMessage(reply);
  assert.ok(shaped.tool_summary?.total >= 1);
});

test("chat/stream speaks the same NDJSON the super-agent's stream does", async () => {
  const base = `http://127.0.0.1:${server.address().port}`;
  const res = await fetch(`${base}/api/projects/1/agents/magui/chat/stream`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: "[mock:tool:list_agents] dale", model: "mock", confirm: false }),
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /application\/x-ndjson/);
  const events = (await res.text())
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
  const types = events.map((e) => e.type);
  assert.ok(types.includes("final"), `expected a final event, got: ${types.join(", ")}`);
  const final = events.find((e) => e.type === "final");
  assert.ok(final.result.conversation_id);
  assert.equal(final.result.trace[0].tool, "list_agents");
  // Tool progress is the whole reason to stream: a client that renders it for
  // Roby must not need a second reader for a project agent.
  assert.ok(
    types.some((t) => t === "tool_start" || t === "tool_result"),
    `expected tool progress events, got: ${types.join(", ")}`
  );
});
