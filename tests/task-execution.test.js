// A task's execution view: evidence of work, apart from its column (#57).
//
// "running" is a workflow label. A card left there after its session ended read
// exactly like one being worked; this view only calls something "working" when
// a linked session is open or an agent turn is on the thread right now.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-task-exec-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx");

const { test, beforeEach } = await import("node:test");
const { default: assert } = await import("node:assert/strict");
const { createTask, getTask, setTaskStatus, addComment } = await import("#core/stores/tasks.js");
const { createRuntimeSession, closeRuntimeSession } = await import("#core/stores/runtime-sessions.js");
const { taskExecution, loadTaskSessions } = await import("#core/tasks/execution.js");
const { enterCascade, leaveCascade, cascadeKey } = await import("#core/tasks/cascades.js");

let STORE;
beforeEach(() => { STORE = fs.mkdtempSync(path.join(TMP_HOME, "proj-")); });

async function view(id, opts = {}) {
  const task = getTask(STORE, id);
  const sessions = opts.sessions ?? await loadTaskSessions(task);
  return taskExecution(task, { storagePath: STORE, ...opts, sessions });
}
/** What runtime-return.js writes when a session starts on a task. */
const link = (taskId, s, runtime = "codex") =>
  addComment(STORE, taskId, { by: runtime, text: "🚀", meta: { apc_session: s.id, session_path: s.path, runtime_phase: "launched" } });

test("a running card with nothing behind it is 'not verified', never 'working'", async () => {
  const t = createTask(STORE, { title: "auditar", status: "running" });
  const v = await view(t.id);
  assert.equal(v.verdict, "not_verified");
  assert.equal(v.runtime.state, "none");
  assert.equal(v.agent_working, false);
});

test("a linked open session is working; once it closes it is not presented as active", async () => {
  const t = createTask(STORE, { title: "corregir", status: "running" });
  // The session lives in ANOTHER project's storage — the link is the comment's
  // file path, so the task still finds it.
  const elsewhere = fs.mkdtempSync(path.join(TMP_HOME, "other-"));
  const s = createRuntimeSession({ projectRoot: elsewhere, storageRoot: elsewhere, agentSlug: "pm", runtime: "codex", taskRef: t.id });
  link(t.id, s);
  let v = await view(t.id);
  assert.equal(v.verdict, "working");
  assert.equal(v.runtime.state, "running");
  assert.equal(v.runtime.session.id, s.id);

  closeRuntimeSession({ filePath: s.path, exitCode: 0, result: "listo" });
  v = await view(t.id);
  assert.equal(v.runtime.state, "finished");
  // The column still says running; the evidence says nothing is.
  assert.equal(v.verdict, "not_verified");
  assert.match(v.runtime.session.result, /listo/);
  // Nothing was moved or closed by the view.
  assert.equal(getTask(STORE, t.id).status, "running");
  assert.equal(getTask(STORE, t.id).state, "open");
});

test("a failed linked session reads as ended, and a comment is the last activity", async () => {
  const t = createTask(STORE, { title: "x", status: "in_review" });
  const s = createRuntimeSession({ projectRoot: STORE, storageRoot: STORE, agentSlug: "apx", runtime: "aider" });
  closeRuntimeSession({ filePath: s.path, exitCode: 1, result: "failed: exit 1" });
  addComment(STORE, t.id, { by: "aider", text: "⚠️ falló", meta: { apc_session: s.id, session_path: s.path, runtime_phase: "failed" } });
  const v = await view(t.id);
  assert.equal(v.runtime.state, "failed");
  assert.equal(v.verdict, "ended");
  assert.equal(v.last_activity.kind, "comment");
});

test("an open record past its deadline is abandoned, not running", async () => {
  const t = createTask(STORE, { title: "viejo", status: "running" });
  const sessions = [{ id: "s1", started: "2020-01-01T00:00:00Z", done: false, abandoned: true, runtime: "codex" }];
  const v = await view(t.id, { sessions });
  assert.equal(v.runtime.state, "abandoned");
  assert.equal(v.verdict, "not_verified");
});

test("an agent turn on the thread right now is working", async () => {
  const t = createTask(STORE, { title: "hilo", status: "pending" });
  const key = cascadeKey(STORE, t.id);
  enterCascade(key);
  try { assert.equal((await view(t.id)).verdict, "working"); } finally { leaveCascade(key); }
  assert.equal((await view(t.id)).verdict, "idle");
});

test("who moved the card is recorded, and what it waits on is named", async () => {
  const t = createTask(STORE, { title: "decidir", created_by: "owner" });
  setTaskStatus(STORE, t.id, "running", { by: "rocky" });
  let v = await view(t.id);
  assert.equal(v.workflow.changed_by, "rocky");
  assert.ok(v.workflow.changed_at);

  addComment(STORE, t.id, { by: "rocky", text: "@owner ¿A o B?" });
  assert.equal((await view(t.id)).waiting_on, "owner_reply");

  setTaskStatus(STORE, t.id, "blocked", { by: "rocky" });
  addComment(STORE, t.id, { by: "owner", text: "B" });
  v = await view(t.id);
  assert.equal(v.waiting_on, "blocked");
  // Re-saving the same column does not rewrite who set it.
  setTaskStatus(STORE, t.id, "blocked", { by: "someone-else" });
  assert.equal((await view(t.id)).workflow.changed_by, "rocky");
});
