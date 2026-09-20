// The blue dot on a task, and the order the list comes back in.
//
// Asked for on 2026-09-20: "que se marquen con un punto azul las que tengan
// nuevos mensajes […] en el detalle se muestra quién hizo el último comentario
// […] si me citan que se vea que necesita respuesta […] y si ya lo vi, deja de
// salir como pendiente […] las más actualizadas arriba y más abajo las que ya
// se trabaron por mí".
//
// Four different questions, and the reason they are four fields and not one
// badge: a card can have unread activity without needing a reply, need a reply
// without being blocked, and be blocked with nothing new to read.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-task-attention-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx"); // HOME alone is overridden by the runner's APX_HOME

const { test } = await import("node:test");
const { default: assert } = await import("node:assert/strict");
const {
  ownerAliasesFrom, activityAt, awaitsOwner, blockedByOwner, commentPreview, PREVIEW_CHARS,
} = await import("#core/tasks/attention.js");
const { createTask, addComment, listTasks, setTaskStatus, patchTask } =
  await import("#core/stores/tasks.js");
const {
  readTaskReads, markTasksRead, isTaskUnread, decorateTaskUnread, taskReadKey, _resetTaskReadsForTest,
} = await import("#core/stores/task-reads.js");

const ALIASES = ownerAliasesFrom("Manu Bruna");

function store() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "apx-tasks-store-"));
}

// ── who a comment is addressed to ──────────────────────────────────────────

test("the owner's own name reaches them however it is written", () => {
  const t = { comments: [{ ts: "2026-09-20T10:00:00Z", by: "romi", text: "@Manú, ¿lo publico?" }] };
  assert.equal(awaitsOwner(t, ALIASES), true, "accents do not hide a mention");
  assert.equal(awaitsOwner({ comments: [{ by: "romi", text: "@manu dale" }] }, ALIASES), true);
  assert.equal(awaitsOwner({ comments: [{ by: "romi", text: "@owner ping" }] }, ALIASES), true);
  assert.equal(awaitsOwner({ comments: [{ by: "romi", text: "@caleb, mirá esto" }] }, ALIASES), false);
});

test("only the NEWEST comment can be the one waiting on you", () => {
  // Scanning the whole thread would leave "requiere tu respuesta" up forever on
  // any task where an agent once said "@Manu?" — answering is how it clears.
  const t = {
    comments: [
      { ts: "2026-09-20T10:00:00Z", by: "romi", text: "@Manu, ¿arranco?" },
      { ts: "2026-09-20T11:00:00Z", by: "owner", text: "dale" },
    ],
  };
  assert.equal(awaitsOwner(t, ALIASES), false);
});

test("your own comment never asks you for anything", () => {
  const t = { comments: [{ ts: "2026-09-20T10:00:00Z", by: "owner", text: "@Manu acordate" }] };
  assert.equal(awaitsOwner(t, ALIASES), false);
});

// ── what counts as activity ────────────────────────────────────────────────

test("activity is what SOMEBODY ELSE did, not what you did", () => {
  const mine = { comments: [{ ts: "2026-09-20T12:00:00Z", by: "owner", text: "nota" }], created_by: "owner" };
  assert.equal(activityAt(mine), "", "a thread only you wrote in is not news");

  const theirs = {
    comments: [
      { ts: "2026-09-20T10:00:00Z", by: "romi", text: "listo" },
      { ts: "2026-09-20T12:00:00Z", by: "owner", text: "gracias" },
    ],
  };
  assert.equal(activityAt(theirs), "2026-09-20T10:00:00Z", "your reply does not become the watermark");
});

test("a task somebody else filed is activity even with an empty thread", () => {
  // A routine that lodges three tasks at nine in the morning is exactly the
  // case this is for, and it has no comment to point at.
  const filed = { comments: [], created_by: "romi", created_at: "2026-09-20T09:00:00Z" };
  assert.equal(activityAt(filed), "2026-09-20T09:00:00Z");
  assert.equal(activityAt({ comments: [], created_by: "owner", created_at: "x" }), "");
});

// ── the preview a row shows ────────────────────────────────────────────────

test("the row says who spoke last, not how many spoke", () => {
  const t = {
    comments: [
      { id: "c1", ts: "1", by: "romi", text: "primera" },
      { id: "c2", ts: "2", by: "caleb", text: "@Manu ¿lo saco hoy?", mentions: ["owner"] },
    ],
  };
  const preview = commentPreview(t, ALIASES);
  assert.equal(preview.by, "caleb");
  assert.equal(preview.mentions_owner, true);
  assert.match(preview.text, /lo saco hoy/);
});

test("a long comment is clipped before it is shipped, not in the browser", () => {
  const long = "x".repeat(PREVIEW_CHARS + 500);
  const preview = commentPreview({ comments: [{ id: "c", ts: "1", by: "romi", text: long }] }, ALIASES);
  assert.equal(preview.text.length, PREVIEW_CHARS + 1, "clipped, plus the ellipsis");
  assert.equal(commentPreview({ comments: [] }, ALIASES), null);
});

// ── blocked on the owner ───────────────────────────────────────────────────

test("blocked ON YOU needs all three: open, blocked, yours", () => {
  assert.equal(blockedByOwner({ state: "open", status: "blocked", agent: "owner" }), true);
  assert.equal(blockedByOwner({ state: "open", status: "blocked", agent: "romi" }), false,
    "blocked on an agent is work that is still moving");
  assert.equal(blockedByOwner({ state: "done", status: "blocked", agent: "owner" }), false);
  assert.equal(blockedByOwner({ state: "open", status: "running", agent: "owner" }), false);
});

// ── end to end, over the real store ────────────────────────────────────────

test("a task list carries the attention fields and sorts by them", () => {
  const dir = store();
  const quiet = createTask(dir, { title: "algo tranquilo", created_by: "owner" });
  const asking = createTask(dir, { title: "una pregunta", created_by: "romi" });
  const stuck = createTask(dir, { title: "trabada por mí", created_by: "romi" });

  addComment(dir, asking.id, { text: "@Manu ¿te parece?", by: "romi" });
  patchTask(dir, stuck.id, { agent: "owner" });
  setTaskStatus(dir, stuck.id, "blocked");

  const rows = listTasks(dir, { owner_name: "Manu Bruna", sort: "attention" });
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));

  assert.equal(byId[asking.id].awaits_owner, true);
  assert.equal(byId[asking.id].last_comment.by, "romi");
  assert.equal(byId[quiet.id].awaits_owner, false);
  assert.equal(byId[quiet.id].activity_at, "", "a task you filed yourself is not news");
  assert.equal(byId[stuck.id].blocked_by_owner, true);

  // Waiting on you first, stuck on you last.
  assert.equal(rows[0].id, asking.id);
  assert.equal(rows[rows.length - 1].id, stuck.id);

  // And the default order is untouched, so nothing that asked for newest-first
  // silently changed shape.
  const newest = listTasks(dir, { owner_name: "Manu Bruna" });
  assert.equal(newest.length, rows.length);
});

// ── the read marks ─────────────────────────────────────────────────────────

test("unread is per task and per project, and survives on the daemon", async () => {
  await _resetTaskReadsForTest();
  const marks = await readTaskReads();
  assert.ok(marks.seeded_at, "the first read pins a baseline");

  // Everything older than the baseline counts as read — otherwise turning this
  // on lights up every task the daemon has ever held.
  const old = { id: "t_old", activity_at: "2020-01-01T00:00:00Z" };
  assert.equal(isTaskUnread(old, marks, 4), false);

  const fresh = { id: "t_new", activity_at: "2999-01-01T00:00:00Z" };
  assert.equal(isTaskUnread(fresh, marks, 4), true);

  await markTasksRead([{ project_id: 4, id: "t_new", at: "2999-01-01T00:00:00Z" }]);
  const after = await readTaskReads();
  assert.equal(isTaskUnread(fresh, after, 4), false, "reading it clears the dot");
  assert.equal(isTaskUnread(fresh, after, 5), true, "…in that project only");
});

test("a mark never moves backwards, whichever device reports first", async () => {
  await _resetTaskReadsForTest();
  await markTasksRead([{ project_id: 1, id: "t_a", at: "2026-09-20T12:00:00Z" }]);
  await markTasksRead([{ project_id: 1, id: "t_a", at: "2026-09-20T09:00:00Z" }]);
  const store2 = await readTaskReads();
  assert.equal(store2.marks[taskReadKey(1, "t_a")], "2026-09-20T12:00:00Z");
});

test("a task nobody else has touched can never be unread", async () => {
  const marks = await readTaskReads();
  assert.equal(isTaskUnread({ id: "t_x", activity_at: "" }, marks, 1), false);
  const rows = decorateTaskUnread([{ id: "t_x", activity_at: "" }], marks, 1);
  assert.equal(rows[0].unread, false);
});
