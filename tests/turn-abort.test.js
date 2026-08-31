// Stopping a running turn.
//
// The web panel's Stop button aborted the browser's fetch and nothing else: the
// run kept going on the daemon, kept calling tools, and persisted its answer to
// a thread nobody was watching. Sending a message mid-turn could only queue
// behind it. Telegram had had a real kill switch all along (one AbortController
// per chat); the web had none, because no route passed a `signal` and there was
// no endpoint to ask.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-turn-abort-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx"); // isolate the apx home too — HOME alone is overridden by the runner's APX_HOME

const { test } = await import("node:test");
const { default: assert } = await import("node:assert/strict");
const { default: express } = await import("express");
const { apiRouter } = await import("./_helpers.js");
const { register: registerExec } = await import("../src/host/daemon/api/exec.js");
const { register: registerTurns } = await import("../src/host/daemon/api/turns.js");
const {
  startActiveTurn, endActiveTurn, abortActiveTurn, getActiveTurnByKey,
  convTurnKey, superAgentTurnKey,
} = await import("../src/host/daemon/active-turns.js");
const { wasAborted, abortedTurnEvent } = await import("../src/host/daemon/api/turn-abort.js");
const { readConversation, listConversations } = await import("#core/stores/conversations.js");

test("abortActiveTurn signals the live turn, and says so when there is nothing to stop", () => {
  const key = convTurnKey("1", "conv-a");
  assert.equal(abortActiveTurn(key), false, "no live turn is not an error, it is a no-op");

  let aborted = false;
  const rec = startActiveTurn(key, { abort: () => { aborted = true; } });
  assert.equal(abortActiveTurn(key), true);
  assert.equal(aborted, true);

  // The private abort hook must not leak to clients through the read path.
  assert.equal("abort" in (getActiveTurnByKey(key) || {}), false);
  endActiveTurn(rec.id);
  assert.equal(abortActiveTurn(key), false, "ended turns are gone");

  // A turn registered without a hook (a caller that cannot cancel) reports
  // honestly rather than pretending it stopped.
  const noHook = startActiveTurn(key, {});
  assert.equal(abortActiveTurn(key), false);
  endActiveTurn(noHook.id);
});

test("superAgentTurnKey keys one live turn per project+channel", () => {
  assert.notEqual(superAgentTurnKey("1", "web"), superAgentTurnKey("1", "web_sidebar"));
  assert.notEqual(superAgentTurnKey("1", "web"), superAgentTurnKey("2", "web"));
});

test("wasAborted only claims the abort we asked for", () => {
  const ours = new AbortController();
  const err = Object.assign(new Error("aborted"), { name: "AbortError" });
  assert.equal(wasAborted(err, ours), false, "our controller never fired — this is a real failure");
  ours.abort();
  assert.equal(wasAborted(err, ours), true);
  // An engine that aborts its own fetch on a timeout throws the same shape;
  // what disambiguates it is OUR controller, which is still untouched.
  const untouched = new AbortController();
  assert.equal(wasAborted(err, untouched), false);
  assert.equal(wasAborted(new Error("boom"), ours), false, "not every throw during an abort is the abort");
});

test("abortedTurnEvent is not an error event", () => {
  const ev = abortedTurnEvent({ text: "medio", trace: [{ tool: "x" }] });
  assert.equal(ev.type, "aborted", "a client rendering errors in red must not accuse the daemon");
  assert.equal(ev.result.text, "medio");
  assert.equal(ev.result.trace.length, 1);
});

test("POST /turns/abort stops a running project-agent turn and keeps the partial", async () => {
  const root = fs.mkdtempSync(path.join(TMP_HOME, "proj-"));
  const storage = fs.mkdtempSync(path.join(TMP_HOME, "store-"));
  fs.mkdirSync(path.join(root, ".apc", "agents"), { recursive: true });
  fs.writeFileSync(path.join(root, ".apc", "project.json"), JSON.stringify({ name: "tmp", apx: "installed" }));
  fs.writeFileSync(
    path.join(root, ".apc", "agents", "magui.md"),
    ["---", "Role: Tester", "Model: mock", "---", "", "You are a test agent."].join("\n"),
  );
  const PROJECT = { id: "1", name: "tmp", path: root, storagePath: storage, logMessage: () => {} };

  const app = express();
  app.use(express.json());
  const router = apiRouter(express, app);
  const ctx = {
    projects: { list: () => [PROJECT], get: () => PROJECT, rebuild: () => {} },
    project: () => PROJECT,
    // A budget the mock cannot exhaust before the abort lands, with stuck
    // detection off so the loop does not close itself first.
    config: {
      model: "mock", engines: {},
      super_agent: { web_max_iters: 400, stuck_detection: { enabled: false } },
    },
    plugins: {},
    registries: null,
  };
  registerExec(router, ctx);
  registerTurns(router, ctx);
  const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    // The model re-fires the tool every step it is offered and holds 60ms per
    // step, so without the abort this turn runs 400 iterations over ~24s. The
    // hold is what makes "stop it while it is running" a real state to test and
    // not a race against a mock that finishes instantly.
    const res = await fetch(`${base}/api/projects/1/agents/magui/chat/stream`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "[mock:loop:list_agents] [mock:slow:60]", model: "mock", channel: "web" }),
    });

    const events = [];
    let conversationId = null;
    let asked = false;
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
        events.push(ev);
        if (ev.conversation_id) conversationId = ev.conversation_id;
        if (ev.result?.conversation_id) conversationId = ev.result.conversation_id;
        // Interrupt once real work is under way — the point is stopping a turn
        // mid-flight, not one that never started.
        if (!asked && events.filter((e) => e.type === "tool_result").length >= 2) {
          asked = true;
          const r = await fetch(`${base}/api/projects/1/turns/abort`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ conversation_id: conversationId }),
          });
          assert.deepEqual(await r.json(), { ok: true, aborted: true });
        }
      }
    }

    const types = events.map((e) => e.type);
    assert.ok(types.includes("aborted"), `the stream must end as aborted, got: ${types.join(",")}`);
    assert.ok(!types.includes("final"), "an interrupted turn did not finish");
    assert.ok(!types.includes("error"), "stopping a turn is not a failure");
    // Far short of the 400 it would have run to on its own.
    assert.ok(types.filter((t) => t === "tool_result").length < 50, "the loop actually stopped");

    // The work the user watched happen stays in the thread: the message that
    // interrupts opens the next turn and reads this as its history.
    const convId = conversationId || listConversations(storage, "magui")[0]?.id;
    const conv = readConversation(storage, "magui", convId);
    const assistant = conv.turns.filter((t) => t.role === "assistant");
    assert.equal(assistant.length, 1, "the partial was persisted, once");
    // The steps go in as their own rows, exactly as a finished turn writes them
    // — an interrupted turn must not be prose with the work erased, or the turn
    // that continues it would not know which tools had already run for real.
    assert.ok(conv.turns.some((t) => t.role === "tool"), "the steps that really ran are in the thread");
    assert.ok(assistant[0].meta?.tool_summary, "and the assistant row is attributed like any other");

    // Nothing is live any more, so a second stop is an honest no-op.
    const again = await fetch(`${base}/api/projects/1/turns/abort`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ conversation_id: convId }),
    });
    assert.deepEqual(await again.json(), { ok: true, aborted: false });
  } finally {
    server.close();
  }
});

test("POST /turns/abort needs something to address", async () => {
  const PROJECT = { id: "1", name: "tmp", path: TMP_HOME, storagePath: TMP_HOME, logMessage: () => {} };
  const app = express();
  app.use(express.json());
  registerTurns(apiRouter(express, app), { project: () => PROJECT });
  const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/projects/1/turns/abort`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
  } finally {
    server.close();
  }
});
