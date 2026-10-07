// A runtime session launched from a task comment reports back to THAT task
// (#55). End to end on the mock engine and a fake runtime CLI: the comment
// summons the coordinator, the coordinator calls call_runtime, the session's
// result lands on the task as one comment, and the coordinator is summoned
// again to read it. Plus the restart half: a daemon that died mid-run leaves an
// IOU the reconciler finishes without duplicating either step.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-task-return-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx");

const { test, afterEach } = await import("node:test");
const { default: assert } = await import("node:assert/strict");
const { makeTempProject, cleanupTempProject } = await import("./_helpers.js");
// comment-turn first: it loads the tool registry, which loads call_runtime —
// the order production boots in.
const { runCommentMentions, _resetTaskTurnCaps } = await import("#core/tasks/comment-turn.js");
const { makeToolHandlers } = await import("#core/agent/tools/registry.js");
const { ProjectManager } = await import("#host/daemon/db.js");
const { createTask, getTask, addComment } = await import("#core/stores/tasks.js");
const { listPendingCallbacks, writePendingCallback, PENDING_CALLBACKS_DIR } = await import("#core/stores/runtime-callbacks.js");
const { postTaskRuntimeResult, taskOriginFrom } = await import("#core/tasks/runtime-return.js");
const { reconcilePendingCallbacks } = await import("#host/daemon/callback-reconciler.js");

const config = {
  super_agent: {
    enabled: false, model: "mock:base", permission_mode: "total",
    model_fallback: { enabled: false }, stuck_detection: { enabled: false },
  },
  engines: {},
};

let root;
afterEach(() => {
  _resetTaskTurnCaps();
  fs.rmSync(PENDING_CALLBACKS_DIR, { recursive: true, force: true });
  try { cleanupTempProject(root); } catch { /* gone */ }
});

function setup() {
  root = makeTempProject({ name: "acme", agents: [{ slug: "roby", role: "Coordinator" }] });
  const projects = new ProjectManager({ engines: {} });
  projects.register(root);
  const entry = projects.list().find((e) => e.path === root);
  const p = projects.get(entry.id);
  p.config = config;
  return { projects, p };
}

/** Rows the web day ledger holds with a runtime phase. */
function webRuntimeRows() {
  const dir = path.join(process.env.APX_HOME, "messages", "web");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl"))
    .flatMap((f) => fs.readFileSync(path.join(dir, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)))
    .filter((r) => r.meta?.runtime_phase);
}

async function withFakeAider(body, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apx-task-return-bin-"));
  const bin = path.join(dir, "aider");
  fs.writeFileSync(bin, '#!/bin/sh\ncase "$*" in *--version*) echo "aider 0.0.0"; exit 0;; esac\n' + body, { mode: 0o755 });
  const old = process.env.PATH;
  process.env.PATH = `${dir}${path.delimiter}${old}`;
  try { return await fn(); } finally { process.env.PATH = old; fs.rmSync(dir, { recursive: true, force: true }); }
}

async function until(fn, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return true; await new Promise((r) => setTimeout(r, 25)); }
  return false;
}

const phases = (task) => task.comments.map((c) => `${c.by}:${c.meta?.runtime_phase || "text"}`);

test("the comment turn hands call_runtime the task as its return address", async () => {
  const { projects, p } = setup();
  const t = createTask(p.storagePath, { title: "auditar el plan" });
  addComment(p.storagePath, t.id, {
    by: "owner",
    text: '@roby lanzalo [mock:tool:call_runtime] [mock:args:{"runtime":"aider","prompt":"auditá","background":false}]',
    mentions: ["roby"],
  });
  await withFakeAider("echo 'auditoría lista'\n", () =>
    runCommentMentions({ p, taskId: t.id, seed: ["roby"], author: "owner", projects, plugins: null, registries: null, config }));

  const task = getTask(p.storagePath, t.id);
  // Foreground: the coordinator reads the output in its own turn, so the
  // session's record is on the task but nobody is summoned by it.
  assert.deepEqual(phases(task), ["owner:text", "aider:done", "roby:text"]);
  const done = task.comments[1];
  assert.match(done.text, /auditoría lista/);
  assert.deepEqual(done.mentions, []);
  assert.equal(done.meta.coordinator, "roby");
  assert.equal(webRuntimeRows().length, 0, "nothing leaked into the web day thread");
});

test("a background run returns ONE result comment to the task and summons the coordinator", async () => {
  const { projects, p } = setup();
  const t = createTask(p.storagePath, { title: "corregir docs" });
  const h = makeToolHandlers({
    projects, plugins: null, registries: null, globalConfig: config, channel: "web",
    channelMeta: { task: { project_id: p.id, task_id: t.id, coordinator: "roby" } },
  });
  await withFakeAider("echo 'docs corregidos'\n", async () => {
    const r = await h.call_runtime({ runtime: "aider", prompt: "corregí los docs" });
    assert.equal(r.status, "launched");
    assert.equal(r.returns_to_task, t.id);
    assert.ok(await until(() => getTask(p.storagePath, t.id).comments.some((c) => c.by === "roby")), "coordinator answered");
  });
  const task = getTask(p.storagePath, t.id);
  assert.deepEqual(phases(task), ["aider:launched", "aider:done", "roby:text"]);
  assert.deepEqual(task.comments[1].mentions, ["roby"]);
  assert.match(task.comments[1].text, /docs corregidos/);
  assert.equal(task.comments[0].meta.apc_session, task.comments[1].meta.apc_session);
  assert.ok(await until(() => listPendingCallbacks().length === 0), "IOU dropped once both steps happened");
  assert.equal(webRuntimeRows().length, 0);
});

test("a failed background run comments the cause and the next step", async () => {
  const { projects, p } = setup();
  const t = createTask(p.storagePath, { title: "falla" });
  const h = makeToolHandlers({
    projects, plugins: null, registries: null, globalConfig: config, channel: "web",
    channelMeta: { task: { project_id: p.id, task_id: t.id, coordinator: "roby" } },
  });
  await withFakeAider("exit 0\n", async () => {
    await h.call_runtime({ runtime: "aider", prompt: "no hace nada" });
    assert.ok(await until(() => getTask(p.storagePath, t.id).comments.some((c) => c.meta?.runtime_phase === "failed")));
  });
  const failed = getTask(p.storagePath, t.id).comments.find((c) => c.meta?.runtime_phase === "failed");
  assert.match(failed.text, /no terminó bien/);
  assert.match(failed.text, /@roby revisá la causa/);
  assert.ok(failed.meta.error);
});

test("the origin comes from context only, never from a half-filled object", () => {
  assert.equal(taskOriginFrom({}), null);
  assert.equal(taskOriginFrom({ task: { task_id: "t1" } }), null);
  assert.deepEqual(taskOriginFrom({ task: { project_id: 0, task_id: "t1", coordinator: "roby" } }),
    { project_id: 0, task_id: "t1", coordinator: "roby" });
});

test("the result comment is idempotent per session, and a deleted task is reported", () => {
  const { p } = setup();
  const t = createTask(p.storagePath, { title: "x" });
  const origin = { project_id: p.id, task_id: t.id, coordinator: "roby" };
  const args = { storagePath: p.storagePath, origin, runtime: "codex", sessionId: "s-1", ok: true, text: "ok" };
  assert.equal(postTaskRuntimeResult(args).posted, true);
  assert.equal(postTaskRuntimeResult(args).duplicate, true);
  assert.equal(getTask(p.storagePath, t.id).comments.length, 1);
  assert.equal(postTaskRuntimeResult({ ...args, origin: { ...origin, task_id: "t-gone" } }).missing, true);
});

// ── restart: the reconciler finishes what a dead daemon could not ────────────

function finishedSession(dir, result = "listo") {
  const file = path.join(dir, "session.md");
  fs.writeFileSync(file, `---\nstatus: completed\ncompleted: 2020-01-01T00:00:00Z\nresult: ${result}\n---\n`);
  return file;
}

test("after a restart the reconciler posts the result once and summons once", async () => {
  const { projects, p } = setup();
  const t = createTask(p.storagePath, { title: "auditar" });
  const sessionPath = finishedSession(fs.mkdtempSync(path.join(TMP_HOME, "sess-")), "auditoría ok");
  writePendingCallback({
    session_id: "s-restart", session_path: sessionPath, channel: "task",
    project_id: p.id, task_id: t.id, coordinator: "roby", runtime: "codex",
  });

  // First pass: a cascade is still running on the thread, so the summon waits.
  const calls = [];
  await reconcilePendingCallbacks({
    projects, plugins: null, config,
    summon: (a) => { calls.push(a); return { summoned: [], skipped: "cascade_running" }; },
  });
  assert.equal(getTask(p.storagePath, t.id).comments.length, 1);
  const kept = listPendingCallbacks()[0];
  assert.ok(kept.result_posted_at, "step 1 recorded on the IOU");
  assert.equal(kept.coordinator_skipped, "cascade_running");

  // Second pass: the summon lands; the comment is NOT written again.
  await reconcilePendingCallbacks({
    projects, plugins: null, config,
    summon: (a) => { calls.push(a); return { summoned: a.mentions, skipped: null }; },
  });
  const task = getTask(p.storagePath, t.id);
  assert.deepEqual(phases(task), ["codex:done"]);
  assert.match(task.comments[0].text, /auditoría ok/);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].mentions, ["roby"]);
  assert.equal(calls[1].author, "codex");
  assert.equal(listPendingCallbacks().length, 0);
});

test("the reconciler drops a task return whose project is gone, without inventing a chat", async () => {
  const { projects } = setup();
  const sessionPath = finishedSession(fs.mkdtempSync(path.join(TMP_HOME, "sess-")));
  writePendingCallback({
    session_id: "s-orphan", session_path: sessionPath, channel: "task",
    project_id: 999, task_id: "t-x", coordinator: "roby", runtime: "codex",
  });
  const logs = [];
  await reconcilePendingCallbacks({ projects, plugins: null, config, log: (m) => logs.push(m), summon: () => assert.fail("no summon") });
  assert.equal(listPendingCallbacks().length, 0);
  assert.ok(logs.some((l) => /project 999 is gone/.test(l)));
});
