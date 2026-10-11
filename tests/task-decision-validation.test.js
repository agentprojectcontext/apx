// A decision card blocks its task on the decider and pings the owner, so text
// that asks nothing — a placeholder, a status line, "disregard this card" — must
// be refused before any of that happens. And a card asked by mistake is taken
// back by withdrawing it, which notifies nobody and clears the owner's badge.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-decision-validation-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx");

const { test, beforeEach } = await import("node:test");
const { default: assert } = await import("node:assert/strict");
const { _resetTaskTurnCaps } = await import("#core/tasks/comment-turn.js");
const { createTask, getTask, listTasks, countTasks, askDecision, withdrawDecision } = await import("#core/stores/tasks.js");
const { requestDecision } = await import("#core/tasks/decisions.js");
const { decisionQuestionProblem } = await import("#core/tasks/decision-question.js");
const { taskExecution } = await import("#core/tasks/execution.js");
const commentTask = (await import("#core/agent/tools/handlers/comment-task.js")).default;
const { makeTempProject, cleanupTempProject } = await import("./_helpers.js");

let STORE;
beforeEach(() => { STORE = fs.mkdtempSync(path.join(TMP_HOME, "proj-")); _resetTaskTurnCaps(); });

function fakeTelegram() {
  const sent = [];
  return { sent, plugins: { get: (n) => (n === "telegram" ? { send: async (m) => { sent.push(m); return { ok: true }; } } : null) } };
}

const NOT_QUESTIONS = [
  "placeholder",
  "x",
  "?",
  "Need update",
  "TBD",
  "n/a",
  "DISREGARD: no decision requested.",
  "Disregard this accidental decision card; no decision is requested.",
  "Please provide decision fields only if requesting a decision.",
  "Ignorá esto, no se requiere ninguna decisión",
  "Update: the tests pass on the branch now",
];

test("text that asks nothing creates no decision, no comment and no notice", async () => {
  for (const question of NOT_QUESTIONS) {
    const t = createTask(STORE, { title: "alerting audit" });
    const tg = fakeTelegram();
    await assert.rejects(
      requestDecision({ storagePath: STORE, taskId: t.id, fields: { question }, by: "pm", plugins: tg.plugins, config: {} }),
      /not a decision .*withdraw it/s,
      question,
    );
    const task = getTask(STORE, t.id);
    assert.equal(task.decisions.length, 0, question);
    assert.equal(task.comments.length, 0, question);
    assert.equal(tg.sent.length, 0, question);
    assert.equal(listTasks(STORE).find((r) => r.id === t.id).awaits_owner, false, question);
  }
  assert.equal(countTasks(STORE).attention.awaits_owner, 0);
});

test("the store itself refuses them, so every surface that asks gets the same rule", () => {
  const t = createTask(STORE, { title: "x" });
  assert.throws(() => askDecision(STORE, t.id, { question: "placeholder", by: "pm" }), /not a decision \(placeholder\)/);
  assert.throws(() => askDecision(STORE, t.id, { question: "  ", by: "pm" }), /question required/);
  assert.equal(getTask(STORE, t.id).decisions.length, 0);
});

test("real questions still pass, in English and Spanish, with or without options", async () => {
  const ok = [
    "Ship on Friday, or wait for the audit?",
    "¿Garantizamos alertas en menos de 5 minutos?",
    "Which region should host the staging database",
    "Should we ignore this flaky e2e spec until the fix lands?",
    "Do we refund the accidental double charge on the acme invoice?",
  ];
  for (const q of ok) assert.equal(decisionQuestionProblem(q), null, q);

  const withOptions = createTask(STORE, { title: "release" });
  const tg = fakeTelegram();
  const a = await requestDecision({
    storagePath: STORE, taskId: withOptions.id, by: "pm", plugins: tg.plugins, config: {},
    fields: { question: "Ship on Friday, or wait for the audit?", options: ["Friday", "After the audit"] },
  });
  assert.equal(a.decision.state, "open");
  assert.deepEqual(a.decision.options, ["Friday", "After the audit"]);
  assert.equal(a.notice.status, "sent");

  const freeText = createTask(STORE, { title: "hosting" });
  const b = await requestDecision({
    storagePath: STORE, taskId: freeText.id, by: "pm", plugins: tg.plugins, config: {},
    fields: { question: "Which region should host the staging database?" },
  });
  assert.equal(b.decision.options.length, 0);
  assert.equal(listTasks(STORE).find((r) => r.id === freeText.id).awaits_owner, true);
  assert.equal(tg.sent.length, 2);
});

test("comment_task refuses a placeholder and withdraws a mistaken card without notifying anyone", async () => {
  const root = makeTempProject({ name: "acme", agents: [{ slug: "pm", role: "PM" }, { slug: "qa", role: "QA" }] });
  const p = { id: 1, name: "acme", path: root, storagePath: STORE };
  const projects = { list: () => [p], get: () => p };
  const tg = fakeTelegram();
  const asPm = commentTask.makeHandler({ projects, channelMeta: { agentSlug: "pm" }, globalConfig: {}, plugins: tg.plugins });
  const t = createTask(STORE, { title: "release plan", status: "blocked" });

  const bad = await asPm({ task: t.id, project: "1", decision: { question: "placeholder" } });
  assert.match(bad.error, /not a decision/);
  assert.equal(getTask(STORE, t.id).decisions.length, 0);
  assert.equal(tg.sent.length, 0);

  const asked = await asPm({ task: t.id, project: "1", decision: { question: "Ship on Friday, or wait for the audit?" } });
  assert.equal(asked.ok, true);
  assert.equal(tg.sent.length, 1);
  assert.equal(listTasks(STORE).find((r) => r.id === t.id).awaits_owner, true);

  // Another agent cannot take back the PM's question.
  const asQa = commentTask.makeHandler({ projects, channelMeta: { agentSlug: "qa" }, globalConfig: {}, plugins: tg.plugins });
  const foreign = await asQa({ task: t.id, project: "1", withdraw_decision: { id: asked.decision.id, reason: "not needed" } });
  assert.match(foreign.error, /only pm/);

  const noReason = await asPm({ task: t.id, project: "1", withdraw_decision: { id: asked.decision.id, reason: " " } });
  assert.match(noReason.error, /reason required/);

  const gone = await asPm({ task: t.id, project: "1", withdraw_decision: { id: asked.decision.id, reason: "asked by mistake" } });
  assert.equal(gone.ok, true);
  assert.equal(gone.decision.state, "withdrawn");
  assert.equal(tg.sent.length, 1, "withdrawing sends nothing");

  const task = getTask(STORE, t.id);
  assert.equal(task.decisions.length, 1, "no new card was created");
  assert.equal(task.decisions[0].withdrawn_reason, "asked by mistake");
  assert.match(task.comments.at(-1).text, /retirada: asked by mistake/);
  assert.equal(listTasks(STORE).find((r) => r.id === t.id).awaits_owner, false);
  assert.equal(countTasks(STORE).attention.awaits_owner, 0);
  const v = taskExecution(task, { storagePath: STORE, agentWorking: false, sessions: [] });
  assert.notEqual(v.waiting_on, "owner_decision");
  assert.notEqual(v.waiting_on, "owner_reply");
  cleanupTempProject(root);
});

test("a decision withdrawn in the store alone no longer leaves its card's @owner comment awaiting a reply", async () => {
  const t = createTask(STORE, { title: "pricing" });
  const out = await requestDecision({ storagePath: STORE, taskId: t.id, by: "pm", fields: { question: "Raise the plan price in March or in April?" } });
  assert.equal(listTasks(STORE).find((r) => r.id === t.id).awaits_owner, true);
  withdrawDecision(STORE, t.id, out.decision.id, { reason: "the owner already said April in chat", by: "pm" });
  assert.equal(listTasks(STORE).find((r) => r.id === t.id).awaits_owner, false);
});
