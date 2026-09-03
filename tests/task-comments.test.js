// Task comments, and the @mentions that summon an agent into one.
//
// The turn engine is injected (`runTurn`), the same trick the group resolver
// uses: what is worth testing here is the cascade and its ceiling, and neither
// needs a model. See src/core/tasks/comment-turn.js.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Anything writing under ~/.apx must own its sandbox BEFORE the modules load
// (AGENTS.md rule 1) — makeTempProject seeds agent memory under APX_HOME.
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "apx-comments-home-"));
process.env.APX_HOME = path.join(tmpHome, ".apx");
process.env.HOME = tmpHome;

const { makeTempProject, cleanupTempProject } = await import("./_helpers.js");
const { createTask, addComment, doneTask, getTask, listTasks } = await import("#core/stores/tasks.js");
const { mentionedAgents, runCommentMentions, MAX_COMMENT_TURNS } =
  await import("#core/tasks/comment-turn.js");

let storagePath;
let root;
let p;

beforeEach(() => {
  storagePath = fs.mkdtempSync(path.join(os.tmpdir(), "apx-comments-"));
  root = makeTempProject({
    name: "acme",
    agents: [{ slug: "qa", description: "QA" }, { slug: "dev", description: "Dev" }],
  });
  p = {
    id: 1, name: "acme", path: root, storagePath,
    config: {}, logMessage: () => {},
  };
});

afterEach(() => {
  try { fs.rmSync(storagePath, { recursive: true, force: true }); } catch { /* gone */ }
  try { cleanupTempProject(root); } catch { /* gone */ }
});

// ── the store half ───────────────────────────────────────────────────────────

test("addComment appends to the thread and moves updated_at", () => {
  const t = createTask(storagePath, { title: "x" });
  assert.deepEqual(t.comments, []);
  const after = addComment(storagePath, t.id, { by: "owner", text: "  arranquemos  " });
  assert.equal(after.comments.length, 1);
  assert.equal(after.comments[0].text, "arranquemos");
  assert.equal(after.comments[0].by, "owner");
  assert.ok(after.comments[0].id.startsWith("c_"));
  // A comment is activity: "what moved?" must see it.
  assert.ok(after.updated_at >= t.updated_at);
});

test("addComment rejects empty text and unknown tasks", () => {
  const t = createTask(storagePath, { title: "x" });
  assert.throws(() => addComment(storagePath, t.id, { text: "   " }));
  assert.equal(addComment(storagePath, "t_nope11", { text: "hi" }), null);
});

test("list rows count comments instead of carrying them", () => {
  const t = createTask(storagePath, { title: "x" });
  addComment(storagePath, t.id, { by: "owner", text: "uno" });
  addComment(storagePath, t.id, { by: "qa", text: "dos" });
  const [row] = listTasks(storagePath, {});
  assert.equal(row.comment_count, 2);
  assert.equal(row.comments, undefined);
  // The detail still gets the thread.
  assert.equal(getTask(storagePath, t.id).comments.length, 2);
});

// ── subtasks ────────────────────────────────────────────────────────────────

test("a subtask is a task with a parent, and the parent counts it", () => {
  const epic = createTask(storagePath, { title: "Onboarding Hexadia" });
  const a = createTask(storagePath, { title: "Multi-empresa", parent: epic.id });
  createTask(storagePath, { title: "Vista gestor", parent: epic.id });

  // Children of one task…
  const kids = listTasks(storagePath, { parent: epic.id });
  assert.deepEqual(kids.map((k) => k.title).sort(), ["Multi-empresa", "Vista gestor"]);

  // …and only top-level tasks when asked for the root.
  const top = listTasks(storagePath, { parent: "" });
  assert.deepEqual(top.map((t) => t.title), ["Onboarding Hexadia"]);

  assert.equal(getTask(storagePath, epic.id).subtask_count, 2);
  assert.equal(getTask(storagePath, epic.id).subtask_done, 0);

  // Closing one child moves the parent's counter, not its state: an epic is
  // done when its owner says so, not when arithmetic says so.
  doneTask(storagePath, a.id);
  const after = getTask(storagePath, epic.id);
  assert.equal(after.subtask_done, 1);
  assert.equal(after.state, "open");
});

// ── mentions ────────────────────────────────────────────────────────────────

test("mentionedAgents resolves agent slugs and ignores everything else", () => {
  assert.deepEqual(mentionedAgents("@qa mirá esto", root), ["qa"]);
  assert.deepEqual(mentionedAgents("@qa y @dev", root), ["qa", "dev"]);
  // The owner speaks by typing, never by being summoned.
  assert.deepEqual(mentionedAgents("@owner ping", root), []);
  // A plain note summons nobody — this is the difference from a group room,
  // where a message with no mention still hands the turn to someone.
  assert.deepEqual(mentionedAgents("nota para mí, sin nadie", root), []);
  assert.deepEqual(mentionedAgents("@nadie existe", root), []);
  // An agent never mentions itself into another turn.
  assert.deepEqual(mentionedAgents("@qa me respondo", root, "qa"), []);
});

test("a mention runs the agent and posts its reply as a comment", async () => {
  const t = createTask(storagePath, { title: "Revisar el flujo" });
  addComment(storagePath, t.id, { by: "owner", text: "@qa probá esto", mentions: ["qa"] });

  const said = await runCommentMentions({
    p, taskId: t.id, seed: ["qa"], author: "owner",
    runTurn: async ({ slug }) => `${slug} listo: dos casos fallan`,
  });

  assert.deepEqual(said.map((s) => s.slug), ["qa"]);
  const thread = getTask(storagePath, t.id).comments;
  assert.equal(thread.length, 2);
  assert.equal(thread[1].by, "qa");
  assert.match(thread[1].text, /dos casos fallan/);
});

test("a reply that mentions someone cascades to them", async () => {
  const t = createTask(storagePath, { title: "PR #108" });
  const said = await runCommentMentions({
    p, taskId: t.id, seed: ["qa"], author: "owner",
    // QA hands off to dev exactly once; dev closes without citing anyone.
    runTurn: async ({ slug }) => (slug === "qa" ? "falla el login, @dev revisalo" : "arreglado"),
  });
  assert.deepEqual(said.map((s) => s.slug), ["qa", "dev"]);
  assert.deepEqual(getTask(storagePath, t.id).comments.map((c) => c.by), ["qa", "dev"]);
});

test("the cascade stops at the ceiling even if they keep citing each other", async () => {
  const t = createTask(storagePath, { title: "ping pong" });
  const said = await runCommentMentions({
    p, taskId: t.id, seed: ["qa"], author: "owner",
    // Each one always tags the other: without a ceiling this never ends.
    runTurn: async ({ slug }) => (slug === "qa" ? "@dev seguí vos" : "@qa seguí vos"),
  });
  assert.equal(said.length, MAX_COMMENT_TURNS);
  assert.equal(getTask(storagePath, t.id).comments.length, MAX_COMMENT_TURNS);
});

test("a failed summon is written into the thread, not swallowed", async () => {
  const t = createTask(storagePath, { title: "x" });
  await runCommentMentions({
    p, taskId: t.id, seed: ["qa"], author: "owner",
    runTurn: async () => { throw new Error("no model for agent qa"); },
  });
  const [note] = getTask(storagePath, t.id).comments;
  assert.equal(note.by, "qa");
  assert.match(note.text, /no model for agent qa/);
});

test("an agent→agent handover is mirrored onto the a2a ledger, with attribution", async () => {
  const rows = [];
  const t = createTask(storagePath, { title: "x" });
  await runCommentMentions({
    p: { ...p, logMessage: (r) => rows.push(r) },
    taskId: t.id, seed: ["qa"], author: "owner",
    // The real runner returns what answered and what it spent; a stub may
    // return a bare string, and both shapes have to work.
    runTurn: async ({ slug }) =>
      slug === "qa"
        ? { text: "@dev tomá", model: "test:model", usage: { total_tokens: 42 } }
        : "ok",
  });
  const a2a = rows.filter((r) => r.channel === "a2a");
  assert.equal(a2a.length, 2); // one `out` for qa, one `in` for dev
  assert.equal(a2a[0].meta.to, "dev");
  assert.equal(a2a[1].meta.from, "qa");
  assert.equal(a2a[0].meta.task, t.id);
  // Without these the row reopens in the viewer as "0 tok, no model" — the
  // regression tests/message-attribution.test.js exists to stop.
  assert.equal(a2a[0].meta.model, "test:model");
  assert.deepEqual(a2a[0].meta.usage, { total_tokens: 42 });
});

test("an unknown or unmentioned seed summons nobody", async () => {
  const t = createTask(storagePath, { title: "x" });
  const said = await runCommentMentions({
    p, taskId: t.id, seed: [], author: "owner",
    runTurn: async () => "should never run",
  });
  assert.deepEqual(said, []);
  assert.deepEqual(getTask(storagePath, t.id).comments, []);
});
