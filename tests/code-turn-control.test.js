// A coding turn you can stop, interrupt, and walk back into.
//
// The chat surfaces got all three when the web learned to abort a run for real
// (674693e). The code module never did, and it is where they matter most: a
// coding turn chains dozens of tools and runs for minutes.
//
//   - Stop closed the browser's fetch and nothing else. The run kept going on
//     the daemon, kept editing files, and persisted its answer into a session
//     nobody was watching.
//   - Writing during a run was simply refused (`if (busy) return`), so there
//     was no way to say "no, do this instead" without waiting it out.
//   - A panel opened or refreshed mid-run showed a finished-looking session
//     with no sign of activity, because a code turn is written to the
//     transcript only when it ENDS. The work was happening; the screen was
//     still. That is the "se ve sin acción pero seguro está corriendo atrás"
//     this file pins down.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-code-turn-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx"); // HOME alone is overridden by the runner's APX_HOME

const { test, before, after } = await import("node:test");
const { default: assert } = await import("node:assert/strict");
const { default: express } = await import("express");
const { apiRouter } = await import("./_helpers.js");
const { register: registerCode } = await import("../src/host/daemon/api/code.js");
const { register: registerTurns } = await import("../src/host/daemon/api/turns.js");
const { codeTurnKey } = await import("../src/host/daemon/active-turns.js");
const { createCodeSession, getCodeSession, appendTurn, truncateCodeSession } = await import(
  "#core/stores/code-sessions.js"
);

let server;
let base;
let PROJECT;

before(async () => {
  const root = fs.mkdtempSync(path.join(TMP_HOME, "proj-"));
  const storage = fs.mkdtempSync(path.join(TMP_HOME, "store-"));
  fs.mkdirSync(path.join(root, ".apc"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".apc", "project.json"),
    JSON.stringify({ name: "acme", apx: "installed" }),
  );
  PROJECT = { id: 0, name: "acme", path: root, storagePath: storage, logMessage: () => {} };

  const projects = {
    list: () => [{ id: PROJECT.id, name: PROJECT.name, path: PROJECT.path }],
    get: () => PROJECT,
    rebuild: () => {},
  };
  const project = (req, res) => {
    if (String(req.params.pid) !== String(PROJECT.id)) {
      res.status(404).json({ error: "project not found" });
      return null;
    }
    return PROJECT;
  };

  const app = express();
  app.use(express.json());
  const router = apiRouter(express, app);
  const ctx = {
    projects,
    project,
    // Stuck detection off: the loop must not close itself before the abort
    // lands, or the test would pass without ever stopping anything.
    config: {
      model: "mock",
      engines: {},
      super_agent: {
        enabled: true,
        model: "mock",
        permission_mode: "auto",
        stuck_detection: { enabled: false },
      },
    },
    plugins: {},
    registries: null,
  };
  registerCode(router, ctx);
  registerTurns(router, ctx);

  server = await new Promise((r) => {
    const s = app.listen(0, "127.0.0.1", () => r(s));
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.close();
  fs.rmSync(TMP_HOME, { recursive: true, force: true });
});

const getJson = async (p) => (await fetch(base + p)).json();

/**
 * Drive a real coding turn, and call `onEvent` for each event as it arrives so
 * the caller can act WHILE the turn is running — which is the only moment any
 * of this is testable.
 */
async function runTurn(sid, prompt, onEvent) {
  const res = await fetch(`${base}/api/projects/0/code/sessions/${sid}/chat/stream`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt, confirm: false }),
  });
  assert.equal(res.status, 200);
  const events = [];
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const ev = JSON.parse(line);
      events.push(ev);
      await onEvent?.(ev, events);
    }
  }
  return events;
}

test("a code turn names itself before doing any work", async () => {
  const session = createCodeSession(PROJECT.storagePath, { projectId: 0, title: "Naming" });
  const events = await runTurn(session.id, "hola");
  const start = events[0];
  assert.equal(start?.type, "start", `the first event must name the turn, got ${start?.type}`);
  assert.ok(start.turn_id, "without an id there is nothing for a client to address");
  assert.equal(
    start.code_session_id,
    session.id,
    "a code session is addressed by its id — the channel does not identify it, since the panel and `apx exec --code` drive the same session under different channel names",
  );
});

test("codeTurnKey ignores the channel, so both surfaces stop the same turn", () => {
  // The web panel runs `web_code` and `apx exec --code` runs `code`. If the key
  // carried the channel, Stop in the panel would quietly miss a turn started
  // from the terminal and report "nothing to stop".
  assert.equal(codeTurnKey("0", "sess-a"), codeTurnKey("0", "sess-a"));
  assert.notEqual(codeTurnKey("0", "sess-a"), codeTurnKey("0", "sess-b"));
  assert.notEqual(codeTurnKey("0", "sess-a"), codeTurnKey("1", "sess-a"));
});

test("a turn in flight is visible to a surface that arrives mid-run", async () => {
  const session = createCodeSession(PROJECT.storagePath, { projectId: 0, title: "Recovery" });
  let seen = null;

  // The model re-fires the tool every step it is offered and holds 60ms per
  // step, so the turn is genuinely still running while we look at it.
  await runTurn(session.id, "[mock:loop:list_projects] [mock:slow:60]", async (_ev, events) => {
    if (seen || events.filter((e) => e.type === "tool_result").length < 2) return;
    // This is exactly what the panel does on load: read the session, and find
    // out that the transcript is not the whole story.
    seen = await getJson(`/api/projects/0/code/sessions/${session.id}`);
    await fetch(`${base}/api/projects/0/turns/abort`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code_session_id: session.id }),
    });
  });

  assert.ok(seen, "the turn never got far enough to be observed");
  assert.ok(seen.active_turn, "a session with a live turn must say so — this is the bug");
  assert.equal(seen.active_turn.thread_id, session.id);
  assert.ok(
    seen.active_turn.parts?.some((p) => p.kind === "tool"),
    "the snapshot must carry the tools the original pane was watching, not just text — a still-working turn without them looks idle",
  );
  // Only while it is running: once it is over the transcript is the record.
  const after = await getJson(`/api/projects/0/code/sessions/${session.id}`);
  assert.equal(after.active_turn, null);
});

test("POST /turns/abort stops a running code turn and keeps what it did", async () => {
  const session = createCodeSession(PROJECT.storagePath, { projectId: 0, title: "Interrupt" });
  let asked = false;
  let aborted = null;

  const events = await runTurn(
    session.id,
    "[mock:loop:list_projects] [mock:slow:60]",
    async (_ev, evs) => {
      if (asked || evs.filter((e) => e.type === "tool_result").length < 2) return;
      asked = true;
      const r = await fetch(`${base}/api/projects/0/turns/abort`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code_session_id: session.id }),
      });
      aborted = await r.json();
    },
  );

  assert.deepEqual(aborted, { ok: true, aborted: true });

  const types = events.map((e) => e.type);
  assert.ok(
    types.includes("aborted"),
    `the stream must end as aborted, got: ${types.join(",")}`,
  );
  assert.ok(
    !types.includes("error"),
    "stopping is a normal outcome — a panel that paints errors red must not accuse the daemon",
  );
  assert.ok(!types.includes("final"), "an interrupted turn did not finish");

  // The partial survives into the session. This is the whole point of
  // interrupting rather than waiting: the message that comes next opens the
  // following turn and reads this as its history, tools included.
  const stored = getCodeSession(PROJECT.storagePath, session.id);
  const last = stored.messages.at(-1);
  assert.equal(last.role, "assistant");
  assert.ok(
    last.parts.some((p) => p.kind === "tool"),
    "the tools that really ran must be in the transcript, or the next turn re-does them",
  );
  assert.equal(
    stored.messages.filter((m) => m.role === "user").length,
    1,
    "the prompt is stored once, whatever happened to the answer",
  );
});

test("aborting a session with nothing running is a no-op, not an error", async () => {
  const session = createCodeSession(PROJECT.storagePath, { projectId: 0, title: "Idle" });
  const r = await fetch(`${base}/api/projects/0/turns/abort`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code_session_id: session.id }),
  });
  // A client that interrupts in order to send must carry on and send either
  // way: the turn may simply have finished a moment before the click landed.
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, aborted: false });
});

test("an engine rotation says why, not just that it happened", async () => {
  // The note is the ONLY place a reader learns the model they asked for is not
  // the one that answered ("le pedí bigpickle y usa gemini"). Without the
  // reason there is nothing to act on — a rate limit, a provider outage and a
  // rejected request all read as the same word.
  const { makeTurnAccumulator } = await import("#core/agent/stream/turn-accumulator.js");
  const acc = makeTurnAccumulator();
  acc.apply({
    type: "engine_failed",
    model: "zen:big-pickle",
    reason: "zen 400: Error from provider (Console): Endpoint is unavailable.",
    retry_with: "gemini:gemini-3.5-flash-lite",
  });
  const [note] = acc.build().notes;
  assert.match(note, /zen:big-pickle/);
  assert.match(note, /Endpoint is unavailable/);
  assert.match(note, /gemini:gemini-3\.5-flash-lite/);
});

// ── Rewinding a session (Regenerate / Edit & resend) ───────────────────────
//
// Both actions in the chat drop everything under a turn and ask again. The code
// module had neither, and the transcript half is what makes them correct: the
// daemon rebuilds a coding turn's history from the stored session, so a pane
// that rewound on its own would ask the model to try again with the answer it
// is replacing still in the prompt.

/** A session with `n` alternating user/assistant turns. */
function sessionOf(n, title) {
  const s = createCodeSession(PROJECT.storagePath, { projectId: 0, title });
  for (let i = 0; i < n; i++) {
    appendTurn(PROJECT.storagePath, s.id, {
      role: i % 2 === 0 ? "user" : "assistant",
      parts: [{ kind: "text", text: `turn ${i}` }],
    });
  }
  return s;
}

test("a rewind keeps the turns before the one being re-asked, and drops the rest", async () => {
  const session = sessionOf(6, "Rewind");
  const res = await fetch(`${base}/api/projects/0/code/sessions/${session.id}/truncate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ keep_visible: 2 }),
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, messages: 2 });

  const stored = getCodeSession(PROJECT.storagePath, session.id);
  assert.deepEqual(
    stored.messages.map((m) => m.parts[0].text),
    ["turn 0", "turn 1"],
  );
});

test("keeping more than there is drops nothing, rather than emptying the session", () => {
  const session = sessionOf(3, "No-op rewind");
  const out = truncateCodeSession(PROJECT.storagePath, session.id, 99);
  assert.equal(out.messages.length, 3);
  // And 0 is a real answer, not a missing one: it clears the transcript.
  assert.equal(truncateCodeSession(PROJECT.storagePath, session.id, 0).messages.length, 0);
});

test("a rewind is refused while a turn is running on the session", async () => {
  const session = sessionOf(2, "Busy rewind");
  let status = null;
  await runTurn(session.id, "[mock:loop:list_projects] [mock:slow:60]", async (_ev, evs) => {
    if (status !== null || evs.filter((e) => e.type === "tool_result").length < 2) return;
    // The running turn appends when it ends. Rewinding under it would have it
    // append onto a transcript that had already moved.
    const r = await fetch(`${base}/api/projects/0/code/sessions/${session.id}/truncate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ keep_visible: 1 }),
    });
    status = r.status;
    await fetch(`${base}/api/projects/0/turns/abort`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code_session_id: session.id }),
    });
  });
  assert.equal(status, 409, "a rewind under a live turn must be refused, not raced");
});

test("keep_visible has to be a real count", async () => {
  const session = sessionOf(2, "Bad rewind");
  for (const bad of [undefined, -1, "two", 1.5]) {
    const r = await fetch(`${base}/api/projects/0/code/sessions/${session.id}/truncate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ keep_visible: bad }),
    });
    assert.equal(r.status, 400, `keep_visible ${JSON.stringify(bad)} must be refused`);
  }
  // Nothing was dropped by any of them.
  assert.equal(getCodeSession(PROJECT.storagePath, session.id).messages.length, 2);
});
