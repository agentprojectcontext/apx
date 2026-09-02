// The two things a group cascade needs that a 1:1 chat already had: a budget
// somebody chose, and a Stop button that reaches it.
//
// A group turn calls the same engine as the web chat with `channel: WEB` — it
// wants the web channel PROMPT — and the tool budget used to fall out of that
// string. So every speaker inherited WEB_TOOL_ITERS (1000), and since one owner
// line can cascade into MAX_TURNS_PER_MESSAGE (10) replies, one message was
// worth 10,000 tool calls: a ceiling nobody picked. Worse, the cascade was the
// one turn shape not registered in active-turns, so POST /turns/abort — the
// route that makes the web Stop button real — had nothing to stop.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-group-control-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx"); // isolate the apx home too — HOME alone is overridden by the runner's APX_HOME

const { test } = await import("node:test");
const { default: assert } = await import("node:assert/strict");
const { default: express } = await import("express");
const { apiRouter } = await import("./_helpers.js");
const { register: registerGroups } = await import("../src/host/daemon/api/groups.js");
const { register: registerTurns } = await import("../src/host/daemon/api/turns.js");
const {
  GROUP_TOOL_ITERS, WEB_TOOL_ITERS, MAX_TOOL_ITERS, groupToolIters, channelToolIters,
} = await import("#core/agent/constants.js");
const { MAX_TURNS_PER_MESSAGE, resolveGroupTurn } = await import("#core/agent/group/turn-resolver.js");
const { CHANNELS } = await import("#core/constants/channels.js");
const { appendMessageToFs, readProjectMessages, readProjectGroupThread } = await import("#core/stores/messages.js");

// ── The number, and why it is that number ────────────────────────────────────

test("groupToolIters — a speaker gets the group budget; config overrides, 0/invalid falls back", () => {
  assert.equal(groupToolIters({}), GROUP_TOOL_ITERS);
  assert.equal(groupToolIters({ super_agent: { group_max_iters: 12 } }), 12);
  assert.equal(groupToolIters({ super_agent: { group_max_iters: 0 } }), GROUP_TOOL_ITERS);
  assert.equal(groupToolIters({ super_agent: { group_max_iters: -3 } }), GROUP_TOOL_ITERS);
  // Deliberately NOT the web knob: a room is not a 1:1 chat, and reading
  // web_max_iters here would put the accident back by another route.
  assert.equal(groupToolIters({ super_agent: { web_max_iters: 999 } }), GROUP_TOOL_ITERS);
});

test("one owner message in a room never costs more than one in a 1:1 web chat", () => {
  // The invariant GROUP_TOOL_ITERS is written against. Each cascade reply is a
  // full tool-loop run, so the two factors multiply — raise either and this
  // fails, which is the point: the product has to stay a number someone chose.
  assert.ok(
    GROUP_TOOL_ITERS * MAX_TURNS_PER_MESSAGE <= WEB_TOOL_ITERS,
    `${GROUP_TOOL_ITERS} x ${MAX_TURNS_PER_MESSAGE} speakers must stay within the ${WEB_TOOL_ITERS} a single watched turn may spend`,
  );
  // And it sits between the two budgets it is not: more room than the bounded
  // conversational default, less than the run-to-completion ceiling.
  assert.ok(GROUP_TOOL_ITERS > MAX_TOOL_ITERS, "a group speaker has real work to do");
  assert.ok(GROUP_TOOL_ITERS < WEB_TOOL_ITERS, "but it is not ten agents each running to completion");
});

test("the 1:1 meaning of web / web_sidebar is untouched", () => {
  // The group budget is passed as an explicit maxIters, never by teaching the
  // channel map about rooms — `channel: WEB` still means the web chat's budget
  // for anything that actually IS the web chat.
  assert.equal(channelToolIters({}, CHANNELS.WEB), WEB_TOOL_ITERS);
  assert.equal(channelToolIters({}, CHANNELS.WEB_SIDEBAR), WEB_TOOL_ITERS);
});

// ── Stopping the cascade, not just the speaker ───────────────────────────────

test("resolveGroupTurn: an aborted cascade does not start the next speaker", async () => {
  const participants = [
    { slug: "owner", name: "Owner", kind: "owner" },
    { slug: "candela", name: "Candela", kind: "agent" },
    { slug: "nati", name: "Nati", kind: "agent" },
  ];
  const ctrl = new AbortController();
  const ran = [];
  const replies = await resolveGroupTurn({
    text: "@candela @nati arranquen",
    participants,
    signal: ctrl.signal,
    runAgent: async (slug) => {
      ran.push(slug);
      ctrl.abort(); // the owner presses Stop while the first speaker is working
      return "listo";
    },
  });
  assert.deepEqual(ran, ["candela"], "the queue behind the interrupted speaker must not run");
  assert.equal(replies.length, 1);

  // A signal that never fires changes nothing: both seeded speakers still run.
  const quiet = [];
  await resolveGroupTurn({
    text: "@candela @nati arranquen",
    participants,
    signal: new AbortController().signal,
    runAgent: async (slug) => { quiet.push(slug); return "listo"; },
  });
  assert.deepEqual(quiet, ["candela", "nati"]);
});

// ── End to end, through the route the panel actually calls ───────────────────

function makeRoom() {
  const root = fs.mkdtempSync(path.join(TMP_HOME, "proj-"));
  const storage = fs.mkdtempSync(path.join(TMP_HOME, "store-"));
  fs.mkdirSync(path.join(root, ".apc", "agents"), { recursive: true });
  fs.writeFileSync(path.join(root, ".apc", "project.json"), JSON.stringify({ name: "tmp", apx: "installed" }));
  for (const [slug, name] of [["candela", "Candela"], ["nati", "Nati"]]) {
    fs.writeFileSync(
      path.join(root, ".apc", "agents", `${slug}.md`),
      ["---", `Name: ${name}`, "Role: Tester", "Model: mock", "---", "", "You are a test agent."].join("\n"),
    );
  }
  return {
    id: "1", name: "tmp", path: root, storagePath: storage,
    logMessage: (row) => appendMessageToFs({ projectRoot: storage, ...row }),
  };
}

async function serve(PROJECT, superAgent) {
  const app = express();
  app.use(express.json());
  const router = apiRouter(express, app);
  const ctx = {
    projects: { list: () => [PROJECT], get: () => PROJECT, rebuild: () => {} },
    project: () => PROJECT,
    config: { model: "mock", engines: {}, super_agent: superAgent },
    plugins: {},
    registries: null,
  };
  registerGroups(router, ctx);
  registerTurns(router, ctx);
  const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

/** Read the NDJSON cascade, calling `onEvent` as each frame lands. */
async function readCascade(res, onEvent = () => {}) {
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
      await onEvent(ev, events);
    }
  }
  return events;
}

test("a group speaker runs on the GROUP budget, not the web chat's", async () => {
  const PROJECT = makeRoom();
  // web_max_iters is set high and deliberately different: if the group ever goes
  // back to resolving its budget from `channel: WEB`, this test runs 400 steps
  // instead of 7 and says so.
  const { server, base } = await serve(PROJECT, {
    web_max_iters: 400, group_max_iters: 7, stuck_detection: { enabled: false },
  });
  try {
    const created = await (await fetch(`${base}/api/projects/1/groups`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Sala", participants: ["candela"] }),
    })).json();

    // Re-fires the tool every step it is offered, so the tool_result count IS
    // the budget minus the step run-agent.js reserves for the tool-free wrap-up.
    const res = await fetch(`${base}/api/projects/1/groups/${created.id}/message/stream`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "[mock:loop:list_agents]" }),
    });
    const events = await readCascade(res);
    assert.equal(events.filter((e) => e.type === "tool_result").length, 6);
    assert.ok(events.some((e) => e.type === "final"), "the turn finished on its own");
  } finally {
    server.close();
  }
});

test("POST /turns/abort stops a running cascade and keeps what the room saw", async () => {
  const PROJECT = makeRoom();
  // A budget the mock cannot exhaust before the abort lands, stuck detection off
  // so the loop does not close itself first.
  const { server, base } = await serve(PROJECT, {
    group_max_iters: 400, stuck_detection: { enabled: false },
  });
  try {
    const created = await (await fetch(`${base}/api/projects/1/groups`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Sala", participants: ["candela", "nati"] }),
    })).json();

    // Both agents are addressed, so the cascade has a SECOND speaker queued
    // behind the first — the reply that used to run anyway after Stop. The 60ms
    // hold per step is what makes "stop it mid-flight" a real state rather than
    // a race against a mock that finishes instantly.
    const res = await fetch(`${base}/api/projects/1/groups/${created.id}/message/stream`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "@candela @nati [mock:loop:list_agents] [mock:slow:60]" }),
    });

    let asked = false;
    const events = await readCascade(res, async (_ev, all) => {
      if (asked || all.filter((e) => e.type === "tool_result").length < 2) return;
      asked = true;
      const r = await fetch(`${base}/api/projects/1/turns/abort`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ channel: "group", thread_id: created.id }),
      });
      assert.deepEqual(await r.json(), { ok: true, aborted: true });
    });

    const types = events.map((e) => e.type);
    assert.ok(types.includes("aborted"), `the cascade must end as aborted, got: ${[...new Set(types)].join(",")}`);
    assert.ok(!types.includes("final"), "an interrupted cascade did not finish");
    assert.ok(!types.includes("error"), "stopping a room is not a failure");
    assert.ok(types.filter((t) => t === "tool_result").length < 50, "the loop actually stopped, short of 400");
    // The whole point: the reply queued behind the one you stopped never ran.
    assert.deepEqual(
      events.filter((e) => e.type === "speaker_start").map((e) => e.slug), ["candela"],
      "@nati was queued and must not have been started after Stop",
    );

    // The steps that really ran stay in the room, so the next owner message
    // reads them as history instead of asking for the same work twice.
    const rows = readProjectMessages(PROJECT.storagePath, { channel: "group" })
      .filter((m) => m.meta?.group_id === created.id);
    assert.ok(rows.some((m) => m.type === "tool" && m.author === "candela"), "the tool rows are in the thread");
    assert.ok(readProjectGroupThread(PROJECT.storagePath, created.id), "the room is still readable");

    // Nothing is live any more, so a second stop is an honest no-op.
    const again = await fetch(`${base}/api/projects/1/turns/abort`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ channel: "group", thread_id: created.id }),
    });
    assert.deepEqual(await again.json(), { ok: true, aborted: false });
  } finally {
    server.close();
  }
});

test("a room is addressed by id: stopping one must not stop the other", async () => {
  // `channel` alone would key one live turn per project — with several rooms
  // open, Stop would hit whichever the map happened to hold.
  const { threadTurnKey, superAgentTurnKey } = await import("../src/host/daemon/active-turns.js");
  assert.notEqual(threadTurnKey("1", "group", "g-a"), threadTurnKey("1", "group", "g-b"));
  assert.notEqual(threadTurnKey("1", "group", "g-a"), threadTurnKey("2", "group", "g-a"));
  assert.notEqual(threadTurnKey("1", "group", "g-a"), superAgentTurnKey("1", "group"));
});
