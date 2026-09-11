// The work a running turn is doing, visible from anywhere.
//
// The daemon kept two records of a turn in flight and they disagreed. A client
// RE-OPENING a chat mid-answer read the active-turn snapshot (which held the
// tools) while a client already FOLLOWING one read the pushed frames (which
// held only tokens) — and a project agent registered no timeline at all, just
// its text. So walking to another chat and back turned a nine-step turn into
// one growing paragraph with every tool erased, on the one surface where the
// steps are the whole point of watching.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-turn-timeline-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx"); // isolate the apx home too — HOME alone is overridden by the runner's APX_HOME

const { test } = await import("node:test");
const { default: assert } = await import("node:assert/strict");
const { default: express } = await import("express");
const { apiRouter } = await import("./_helpers.js");
const { register: registerExec } = await import("../src/host/daemon/api/exec.js");
const { register: registerTurns } = await import("../src/host/daemon/api/turns.js");
const { register: registerConversations } = await import("../src/host/daemon/api/conversations.js");
const { isVisibleTurnEvent } = await import("../src/host/daemon/active-turns.js");

test("isVisibleTurnEvent picks exactly the timeline, on every surface", () => {
  assert.equal(isVisibleTurnEvent({ type: "assistant_text", text: "Reviso." }), true);
  assert.equal(
    isVisibleTurnEvent({ type: "tool_start", trace: { id: "t1", tool: "list_agents" } }),
    true,
  );
  assert.equal(
    isVisibleTurnEvent({ type: "tool_result", trace: { id: "t1", result: { ok: true } } }),
    true,
  );

  // Tokens travel as `delta` frames; sending them twice would double the text.
  assert.equal(isVisibleTurnEvent({ type: "assistant_delta", delta: "ho" }), false);
  // The thinking is never pushed to a surface that did not ask for it.
  assert.equal(isVisibleTurnEvent({ type: "assistant_reasoning", reasoning: "hmm" }), false);
  assert.equal(isVisibleTurnEvent({ type: "model_start", model: "mock" }), false);
  // Nothing to show is not a step.
  assert.equal(isVisibleTurnEvent({ type: "assistant_text", text: "" }), false);
  assert.equal(isVisibleTurnEvent({ type: "tool_start", trace: {} }), false);
  assert.equal(isVisibleTurnEvent(null), false);
});

test("a project agent's live turn carries its tools to a client that re-opens the chat", async () => {
  const root = fs.mkdtempSync(path.join(TMP_HOME, "proj-"));
  const storage = fs.mkdtempSync(path.join(TMP_HOME, "store-"));
  fs.mkdirSync(path.join(root, ".apc", "agents"), { recursive: true });
  fs.writeFileSync(path.join(root, ".apc", "project.json"), JSON.stringify({ name: "tmp", apx: "installed" }));
  fs.writeFileSync(
    path.join(root, ".apc", "agents", "reels.md"),
    ["---", "Role: Tester", "Model: mock", "---", "", "You are a test agent."].join("\n"),
  );
  const PROJECT = { id: "1", name: "tmp", path: root, storagePath: storage, logMessage: () => {} };

  const app = express();
  app.use(express.json());
  const router = apiRouter(express, app);
  const ctx = {
    projects: { list: () => [PROJECT], get: () => PROJECT, rebuild: () => {} },
    project: () => PROJECT,
    config: {
      model: "mock", engines: {},
      super_agent: { web_max_iters: 400, stuck_detection: { enabled: false } },
    },
    plugins: {},
    registries: null,
  };
  registerExec(router, ctx);
  registerTurns(router, ctx);
  registerConversations(router, ctx);
  const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    // The mock re-fires the tool every step and holds 60ms per step, so the turn
    // is still running while we ask about it from "another tab" — which is the
    // only state worth testing.
    const res = await fetch(`${base}/api/projects/1/agents/reels/chat/stream`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "[mock:loop:list_agents] [mock:slow:60]", model: "mock", channel: "web" }),
    });

    let conversationId = null;
    let snapshot = null;
    let asked = false;
    let tools = 0;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const ev = JSON.parse(line);
        if (ev.conversation_id) conversationId = ev.conversation_id;
        if (ev.result?.conversation_id) conversationId = ev.result.conversation_id;
        if (ev.type === "tool_result") tools++;
        if (!asked && tools >= 2) {
          asked = true;
          // Exactly what a re-opened pane reads: the stored history plus the
          // turn being written right now.
          const detail = await fetch(
            `${base}/api/projects/1/agents/reels/conversations/${conversationId}`,
          ).then((r) => r.json());
          snapshot = detail.active_turn;
          await fetch(`${base}/api/projects/1/turns/abort`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ conversation_id: conversationId }),
          });
        }
      }
    }

    assert.ok(snapshot, "a turn in flight must be visible to a client that did not start it");
    const shown = (snapshot.parts || []).filter((p) => p.kind === "tool");
    assert.ok(
      shown.length >= 1,
      `the partial must carry the tools, not only the text: ${JSON.stringify(snapshot.parts)}`,
    );
    assert.equal(shown[0].tool, "list_agents");
    assert.ok(
      ["running", "done", "error"].includes(shown[0].status),
      "a tool row says where it got to, so a re-opened turn does not look idle",
    );
  } finally {
    server.close();
  }
});
