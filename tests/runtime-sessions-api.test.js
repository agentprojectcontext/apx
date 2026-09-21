// Runtime sessions you can look at, and write back into.
//
// `call_runtime` has written one record per run since it existed, and until now
// nothing read them back except the resume path. On 2026-09-20 that meant nine
// Claude Code sessions ran, six were killed at a deadline, and the only account
// of any of it was the launching agent's claim that work was in progress.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// APX_HOME before ANY #core import: the ProjectManager's storagePath hangs off
// it, and a test that seeds sessions without this writes them into the real
// ~/.apx. It has happened three times; the third one ate a day of the ledger.
const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-runtime-sessions-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx");

const { test } = await import("node:test");
const { default: assert } = await import("node:assert/strict");
const { ProjectManager } = await import("#host/daemon/db.js");
const { buildApi } = await import("#host/daemon/api.js");
const { createRuntimeSession, closeRuntimeSession, listRuntimeSessions } =
  await import("#core/stores/runtime-sessions.js");
const { makeTempProject, cleanupTempProject } = await import("./_helpers.js");

async function listen(app) {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

function makeApp(root) {
  const projects = new ProjectManager({});
  const { id } = projects.register(root);
  const app = buildApi({
    projects,
    registries: null,
    plugins: { get: () => null, status: () => ({}) },
    scheduler: null,
    version: "test",
    startedAt: Date.now(),
    addProjectGlobally: () => {},
    config: { host: "127.0.0.1", port: 7430, super_agent: { permission_mode: "total" } },
    token: "",
  });
  return { app, id, projects, storage: projects.get(id).storagePath };
}

/** A finished session on disk, the way call_runtime leaves one. */
function seed(storageRoot, { runtime = "claude-code", cwd = "/tmp/repo", result = "listo", exitCode = 0 } = {}) {
  const s = createRuntimeSession({
    projectRoot: storageRoot,
    storageRoot,
    agentSlug: "apx",
    runtime,
    cwd,
    title: `Runtime: ${runtime}`,
  });
  closeRuntimeSession({ filePath: s.path, externalSessionPath: null, exitCode, result });
  return s;
}

test("a session file round-trips through the store, cwd and all", () => {
  const root = makeTempProject({ name: "Uno", agents: [] });
  try {
    const s = seed(root, { cwd: "/Volumes/repo/apx" });
    const [row] = listRuntimeSessions(root);
    assert.equal(row.id, s.id);
    assert.equal(row.runtime, "claude-code");
    assert.equal(row.cwd, "/Volumes/repo/apx", "continuing a session has to reopen the same repo");
    assert.equal(row.done, true);
    assert.equal(row.failed, false);
  } finally {
    cleanupTempProject(root);
  }
});

test("a multi-line result does not tear the frontmatter in half", () => {
  // Seen on 2026-09-20-05: the engine answered with a markdown report, the
  // newlines ended the frontmatter early, and everything after them — `runtime`,
  // `external_session_path` — fell into the body. The session came back with
  // `runtime: undefined`, which is a session you cannot resume.
  const root = makeTempProject({ name: "Uno", agents: [] });
  try {
    seed(root, { result: "# Auditoría\n\nRepo: apx.\n\n- uno\n- dos" });
    const [row] = listRuntimeSessions(root);
    assert.equal(row.runtime, "claude-code", "the fields after `result` survived");
    assert.ok(!String(row.result).includes("\n"));
    assert.match(row.result, /Auditoría/);
  } finally {
    cleanupTempProject(root);
  }
});

test("a session that was killed reads as failed, not as finished", () => {
  const root = makeTempProject({ name: "Uno", agents: [] });
  try {
    seed(root, { exitCode: 143, result: "failed: killed (timeout after 300s)" });
    const [row] = listRuntimeSessions(root);
    assert.equal(row.done, true);
    assert.equal(row.failed, true, "six of nine sessions that afternoon looked exactly like this");
  } finally {
    cleanupTempProject(root);
  }
});

test("a record nothing ever closed stops claiming to be running", () => {
  // Nothing writes `completed` when the run does not end: the daemon is killed
  // mid-flight, the machine sleeps, the process dies past the point that closes
  // the file. The record then says "🔄 In progress" for ever, and the list
  // showed two sessions under a spinner eleven and twenty-three days after they
  // stopped — "¿por qué estos dos se ven corriendo si ya terminaron?" (Manu,
  // 2026-09-20). A run cannot outlive its own deadline, so time is the answer.
  const root = makeTempProject({ name: "Uno", agents: [] });
  try {
    const fresh = createRuntimeSession({
      projectRoot: root, storageRoot: root, agentSlug: "apx", runtime: "claude-code", cwd: "/tmp",
    });
    // Just launched: open, and believably so.
    let row = listRuntimeSessions(root).find((r) => r.id === fresh.id);
    assert.equal(row.done, false);
    assert.equal(row.abandoned, false, "a run that started seconds ago is running");

    // The same record, with its start backdated a day. Still open, no longer
    // credible: the deadline APX hands out is an hour.
    const text = fs.readFileSync(fresh.path, "utf8");
    const old = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    fs.writeFileSync(fresh.path, text.replace(/^started: .*$/m, `started: ${old}`));
    row = listRuntimeSessions(root).find((r) => r.id === fresh.id);
    assert.equal(row.done, false, "it never closed — the record is not rewritten");
    assert.equal(row.abandoned, true, "and it is not running either");
  } finally {
    cleanupTempProject(root);
  }
});

test("a record with no start at all is not a live run", () => {
  // Written by an older APX, or truncated. Unparseable has to fall on the side
  // that does not invent work in progress.
  const root = makeTempProject({ name: "Uno", agents: [] });
  try {
    const s = createRuntimeSession({
      projectRoot: root, storageRoot: root, agentSlug: "apx", runtime: "codex", cwd: "/tmp",
    });
    const text = fs.readFileSync(s.path, "utf8");
    fs.writeFileSync(s.path, text.replace(/^started: .*$/m, "started: "));
    const row = listRuntimeSessions(root).find((r) => r.id === s.id);
    assert.equal(row.abandoned, true);
  } finally {
    cleanupTempProject(root);
  }
});

test("a finished session is never called abandoned, however old", () => {
  const root = makeTempProject({ name: "Uno", agents: [] });
  try {
    seed(root);
    const [row] = listRuntimeSessions(root);
    assert.equal(row.done, true);
    assert.equal(row.abandoned, false, "it closed — that is the whole difference");
  } finally {
    cleanupTempProject(root);
  }
});

test("GET /runtime-sessions lists them newest first, with the project on each", async () => {
  const root = makeTempProject({ name: "Uno", agents: [] });
  const { app, id, storage } = makeApp(root);
  const { server, baseUrl } = await listen(app);
  try {
    seed(storage, { runtime: "codex", result: "primera" });
    seed(storage, { runtime: "claude-code", result: "segunda" });
    const body = await fetch(`${baseUrl}/api/runtime-sessions`).then((r) => r.json());
    const rows = body.data ?? body.items ?? body;
    assert.equal(rows.length, 2);
    for (const row of rows) {
      assert.equal(row.project_id, id);
      assert.equal(row.project_name, "Uno");
      assert.ok(!("path" in row), "a list does not leak absolute paths it does not need to");
    }
  } finally {
    server.close();
    cleanupTempProject(root);
  }
});

test("continuing a session refuses a runtime it cannot spawn, instead of guessing", async () => {
  // A record written before `runtime` was a field, or by an engine this daemon
  // does not know: starting SOME other engine under that session's name is the
  // one failure worse than refusing.
  const root = makeTempProject({ name: "Uno", agents: [] });
  const { app, id, storage } = makeApp(root);
  const { server, baseUrl } = await listen(app);
  try {
    const s = seed(storage, { runtime: "an-engine-that-does-not-exist" });
    const res = await fetch(`${baseUrl}/api/projects/${id}/runtime-sessions/${s.id}/continue`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "seguí con eso" }),
    });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /no runnable runtime/);
  } finally {
    server.close();
    cleanupTempProject(root);
  }
});

test("continuing needs something to say, and a session that exists", async () => {
  const root = makeTempProject({ name: "Uno", agents: [] });
  const { app, id, storage } = makeApp(root);
  const { server, baseUrl } = await listen(app);
  try {
    const s = seed(storage);
    const empty = await fetch(`${baseUrl}/api/projects/${id}/runtime-sessions/${s.id}/continue`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "   " }),
    });
    assert.equal(empty.status, 400);

    const missing = await fetch(`${baseUrl}/api/projects/${id}/runtime-sessions/2001-01-01-99/continue`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "hola" }),
    });
    assert.equal(missing.status, 404);
  } finally {
    server.close();
    cleanupTempProject(root);
  }
});

test("the detail carries the notes the runtime left; the list does not", async () => {
  const root = makeTempProject({ name: "Uno", agents: [] });
  const { app, id, storage } = makeApp(root);
  const { server, baseUrl } = await listen(app);
  try {
    const s = seed(storage);
    fs.appendFileSync(s.path, "\nLo que fui anotando mientras trabajaba.\n");

    const list = await fetch(`${baseUrl}/api/runtime-sessions`).then((r) => r.json());
    const row = (list.data ?? list.items)[0];
    assert.ok(!row.body, "a list of fifty sessions must not ship fifty transcripts");

    const detail = await fetch(`${baseUrl}/api/projects/${id}/runtime-sessions/${s.id}`).then((r) => r.json());
    assert.match(detail.body, /Lo que fui anotando/);
  } finally {
    server.close();
    cleanupTempProject(root);
  }
});

test("a session is a room in the chat list, wearing the engine's face", async () => {
  const root = makeTempProject({ name: "Rooms" });
  const { app, id, projects, storage } = makeApp(root);
  const { server, baseUrl } = await listen(app);
  try {
    const { openRuntimeRoom, appendRuntimePrompt, appendRuntimeReply } =
      await import("#core/stores/runtime-room.js");
    // THE APP'S OWN manager, not a second one over the same folder: storagePath
    // hangs off the registration, so a fresh ProjectManager writes the rows
    // into a different `~/.apx/projects/<id>` from the one the API reads.
    const p = projects.get(id);

    openRuntimeRoom(p.logMessage, {
      session_id: "s-room-1", runtime: "claude-code", cwd: "/tmp/repo",
      title: "arreglá el login", launched_by: "roby",
    });
    appendRuntimePrompt(p.logMessage, "s-room-1", { body: "arreglá el login", authored_by: "roby" });
    appendRuntimeReply(p.logMessage, "s-room-1", { runtime: "claude-code", body: "listo" });

    const rows = await fetch(`${baseUrl}/api/inbox?limit=50`).then((r) => r.json());
    const room = (rows.data || []).find((r) => r.kind === "runtime");
    assert.ok(room, "the session shows up in the one list that shows every conversation");
    assert.equal(room.conversation_id, "s-room-1");
    assert.equal(room.channel, "runtime");
    assert.equal(room.agent_slug, "runtime:s-room-1");
    assert.equal(room.agent_name, "arreglá el login", "titled by what it is DOING");
    // No branch in the row component: AgentAvatar ships a logo per engine, so
    // the engine's name in `agent_icon` is what makes the row recognisable.
    assert.equal(room.agent_icon, "claude-code");

    const thread = await fetch(
      `${baseUrl}/api/projects/${id}/runtime-rooms/s-room-1`,
    ).then((r) => r.json());
    assert.equal(thread.messages.length, 2);
    assert.equal(thread.messages[0].on_behalf_of, "owner", "Roby asked in Manu's name");
    assert.equal(thread.messages[1].agent, "claude-code", "and the engine answered as itself");
    void storage;
  } finally {
    server.close();
    cleanupTempProject(root);
  }
});

test("starting a session from the panel is the owner's, and it opens its own room", async () => {
  const root = makeTempProject({ name: "Nueva" });
  const { app, id, projects } = makeApp(root);
  const { server, baseUrl } = await listen(app);
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), "apx-start-bin-"));
  const oldPath = process.env.PATH;
  try {
    fs.writeFileSync(path.join(bin, "aider"), "#!/bin/sh\necho 'arrancada'\n", { mode: 0o755 });
    fs.chmodSync(path.join(bin, "aider"), 0o755);
    process.env.PATH = `${bin}${path.delimiter}${oldPath}`;

    const bad = await fetch(`${baseUrl}/api/projects/${id}/runtime-sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runtime: "no-such-engine", prompt: "x" }),
    });
    assert.equal(bad.status, 400, "an engine this daemon cannot spawn is refused, not guessed");

    const res = await fetch(`${baseUrl}/api/projects/${id}/runtime-sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runtime: "aider", prompt: "arrancá con esto" }),
    });
    assert.equal(res.status, 202, "launched, not awaited: a coding session is minutes, not a request");
    const out = await res.json();
    assert.ok(out.apc_session, "it says which session it opened");

    const { listProjectRuntimeRooms } = await import("#core/stores/runtime-room.js");
    const room = listProjectRuntimeRooms(projects.get(id).storagePath)
      .find((r) => r.id === out.apc_session);
    assert.ok(room, "and that session has a room");
    assert.equal(room.launched_by, "owner", "the owner started it — not whatever agent the tool defaults to");
    assert.equal(room.title, "arrancá con esto");
    // cwd defaults to the project's own folder. It is the field that mattered
    // most on 2026-09-20: nine sessions opened somewhere else entirely.
    assert.ok(room.cwd, "a room remembers where it opened");
  } finally {
    process.env.PATH = oldPath;
    fs.rmSync(bin, { recursive: true, force: true });
    server.close();
    cleanupTempProject(root);
  }
});

test("a launch from the panel is DETACHED — the request does not wait out the run", async () => {
  // THE BUG THIS EXISTS FOR. The route asks for `background: true` and says so
  // in a comment ("waiting on it would be the 300s deadline again"), but the
  // handler only honours it when it has somewhere to deliver a late result —
  // and the test for that, `runtimeThreadCanCarry`, answers a different
  // question: "should a receipt go in this channel's day thread?". For a room
  // channel that is no, because the room already holds both sides. Reading one
  // as the other silently turned every panel launch back into a foreground run
  // against a 300s deadline a coding session cannot survive.
  //
  // The session's own room IS the delivery path — `runToCompletion` writes the
  // engine's answer into it either way — so this asserts the only thing that
  // tells the two modes apart from outside: a detached launch answers before
  // the engine does.
  const root = makeTempProject({ name: "Detached" });
  const { app, id } = makeApp(root);
  const { server, baseUrl } = await listen(app);
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), "apx-detach-bin-"));
  const oldPath = process.env.PATH;
  const SLEEP_S = 3;
  try {
    // Instant for the availability probe (`--version`), slow for a real run.
    // Without the split the 3s belongs to the probe, which BOTH modes wait on,
    // and the test measures the wrong thing.
    fs.writeFileSync(
      path.join(bin, "aider"),
      `#!/bin/sh\ncase "$1" in --version) echo 'aider 0.0.0'; exit 0;; esac\nsleep ${SLEEP_S}\necho 'tarde'\n`,
      { mode: 0o755 },
    );
    fs.chmodSync(path.join(bin, "aider"), 0o755);
    process.env.PATH = `${bin}${path.delimiter}${oldPath}`;

    const started = Date.now();
    const res = await fetch(`${baseUrl}/api/projects/${id}/runtime-sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runtime: "aider", prompt: "algo que tarda" }),
    });
    const elapsed = Date.now() - started;
    const out = await res.json();

    assert.equal(res.status, 202);
    assert.equal(out.status, "launched", "it reports a launch, not a finished run");
    assert.equal(out.background, true);
    assert.equal(out.output, undefined, "a detached launch has no output yet — that is the point");
    assert.ok(
      elapsed < SLEEP_S * 1000,
      `the request came back in ${elapsed}ms, before the ${SLEEP_S}s run: it did not wait`,
    );
  } finally {
    process.env.PATH = oldPath;
    fs.rmSync(bin, { recursive: true, force: true });
    server.close();
    cleanupTempProject(root);
  }
});

test("the engine menu only offers what this machine can actually start", async () => {
  const root = makeTempProject({ name: "Engines" });
  const { app } = makeApp(root);
  const { server, baseUrl } = await listen(app);
  try {
    const out = await fetch(`${baseUrl}/api/runtime-engines`).then((r) => r.json());
    assert.ok(Array.isArray(out.engines) && out.engines.length, "it answers with the catalogue");
    for (const e of out.engines) {
      assert.equal(typeof e.id, "string");
      assert.equal(typeof e.installed, "boolean");
    }
    // A menu that offers an engine this machine does not have is a menu whose
    // first tap is an error — the panel filters on this flag.
    assert.ok(out.engines.some((e) => e.id === "claude-code"), "claude-code is in the catalogue");
  } finally {
    server.close();
    cleanupTempProject(root);
  }
});
