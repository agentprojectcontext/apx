// Decisions on a task (#58): a structured question instead of "NEEDS USER
// INPUT" buried in a report. The owner sees it on the card and gets ONE notice
// whose real outcome is recorded; another agent's correction goes to that agent;
// the answer comes back to the asker and approves nothing.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-task-decisions-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx");

const { test, beforeEach } = await import("node:test");
const { default: assert } = await import("node:assert/strict");
const { _resetTaskTurnCaps } = await import("#core/tasks/comment-turn.js");
const { createTask, getTask, listTasks, askDecision, answerDecision, withdrawDecision } = await import("#core/stores/tasks.js");
const { requestDecision, resolveDecision, notifyOwnerOfDecision } = await import("#core/tasks/decisions.js");
const { taskExecution } = await import("#core/tasks/execution.js");
const commentTask = (await import("#core/agent/tools/handlers/comment-task.js")).default;

let STORE;
beforeEach(() => { STORE = fs.mkdtempSync(path.join(TMP_HOME, "proj-")); _resetTaskTurnCaps(); });

function fakeTelegram({ fail = false } = {}) {
  const sent = [];
  return {
    sent,
    plugins: { get: (n) => (n === "telegram" ? { send: async (m) => { if (fail) throw new Error("chat not found"); sent.push(m); return { ok: true }; } } : null) },
  };
}

const ASK = {
  question: "¿Garantizamos alertas en menos de 5 minutos?",
  options: ["Sí, con cola dedicada", "No, best effort"],
  recommendation: "Sí: el cliente lo pidió por escrito; cuesta un worker más.",
  blocking: "la auditoría final",
  can_continue: "la corrección documental del PM",
};

test("an owner decision raises attention on the card, notifies once, and records how it went", async () => {
  const t = createTask(STORE, { title: "auditoría de alertas", status: "running" });
  const tg = fakeTelegram();
  const out = await requestDecision({ storagePath: STORE, taskId: t.id, fields: ASK, by: "auditor", plugins: tg.plugins, config: {}, projectName: "acme" });
  assert.equal(out.decision.responsible, "owner");
  assert.equal(out.notice.status, "sent");
  assert.equal(tg.sent.length, 1);
  assert.match(tg.sent[0].text, /auditoría de alertas/);
  assert.match(tg.sent[0].text, /5 minutos/);

  const row = listTasks(STORE).find((x) => x.id === t.id);
  assert.equal(row.awaits_owner, true);
  assert.equal(row.open_decisions, 1);
  const task = getTask(STORE, t.id);
  assert.equal(task.decisions[0].notice.status, "sent");
  assert.match(task.comments.at(-1).text, /Decisión pendiente/);

  // A second attempt never re-sends: dedup is per decision.
  await notifyOwnerOfDecision({ storagePath: STORE, taskId: t.id, decision: out.decision, plugins: tg.plugins, config: {} });
  assert.equal(tg.sent.length, 1);

  const v = taskExecution(getTask(STORE, t.id), { storagePath: STORE, agentWorking: false, listSessions: () => [] });
  assert.equal(v.waiting_on, "owner_decision");
});

test("no channel, or a failed send, is recorded as such — never as delivered", async () => {
  const a = createTask(STORE, { title: "a" });
  const r1 = await requestDecision({ storagePath: STORE, taskId: a.id, fields: ASK, by: "auditor", plugins: null, config: {} });
  assert.equal(r1.notice.status, "no_channel");
  const b = createTask(STORE, { title: "b" });
  const r2 = await requestDecision({ storagePath: STORE, taskId: b.id, fields: ASK, by: "auditor", plugins: fakeTelegram({ fail: true }).plugins, config: {} });
  assert.equal(r2.notice.status, "failed");
  assert.match(getTask(STORE, b.id).decisions[0].notice.error, /chat not found/);
});

test("a correction another agent owes goes to that agent, not to the owner", async () => {
  const t = createTask(STORE, { title: "auditoría" });
  const tg = fakeTelegram();
  const calls = [];
  const out = await requestDecision({
    storagePath: STORE, taskId: t.id, by: "auditor", plugins: tg.plugins, config: {},
    fields: { question: "¿Corregís §3 del plan?", responsible: "pm" },
    summon: (m) => { calls.push(m); return { summoned: m, skipped: null }; },
  });
  assert.deepEqual(calls, [["pm"]]);
  assert.equal(out.notice, null);
  assert.equal(tg.sent.length, 0, "the owner is not pinged for the PM's work");
  assert.equal(listTasks(STORE).find((x) => x.id === t.id).awaits_owner, false);
  assert.deepEqual(getTask(STORE, t.id).comments.at(-1).mentions, ["pm"]);
});

test("the answer names its decision, goes back to the asker, and approves nothing", () => {
  const t = createTask(STORE, { title: "auditoría", status: "blocked" });
  const { decision } = askDecision(STORE, t.id, { ...ASK, by: "auditor" });
  const handed = [];
  const out = resolveDecision({
    storagePath: STORE, taskId: t.id, decisionId: decision.id, answer: "Sí, con cola dedicada", choice: 0, by: "owner",
    handBack: (asker, author) => handed.push([asker, author]),
  });
  assert.equal(out.decision.state, "answered");
  assert.equal(out.decision.choice, 0);
  assert.deepEqual(handed, [["auditor", "owner"]]);
  const task = getTask(STORE, t.id);
  assert.match(task.comments.at(-1).text, new RegExp(decision.id));
  assert.deepEqual(task.comments.at(-1).mentions, ["auditor"]);
  assert.equal(task.status, "blocked");
  assert.equal(task.state, "open");
  assert.equal(listTasks(STORE).find((x) => x.id === t.id).awaits_owner, false);
  // Answered once is answered: the same question cannot be answered again.
  assert.throws(() => answerDecision(STORE, t.id, decision.id, { answer: "no", by: "owner" }), /already answered/);
});

test("only the responsible party (or the owner) can answer; withdrawing needs a reason", () => {
  const t = createTask(STORE, { title: "x" });
  const { decision } = askDecision(STORE, t.id, { question: "¿v2?", responsible: "pm", by: "auditor" });
  assert.throws(() => answerDecision(STORE, t.id, decision.id, { answer: "sí", by: "qa" }), /only pm/);
  answerDecision(STORE, t.id, decision.id, { answer: "sí", by: "pm" });
  const { decision: d2 } = askDecision(STORE, t.id, { question: "¿otra?", by: "auditor" });
  assert.throws(() => withdrawDecision(STORE, t.id, d2.id, { reason: "" }), /reason required/);
  withdrawDecision(STORE, t.id, d2.id, { reason: "ya no aplica", by: "auditor" });
  assert.equal(getTask(STORE, t.id).decisions[1].state, "withdrawn");
});

test("comment_task asks and answers decisions from the agent side", async () => {
  const t = createTask(STORE, { title: "plan" });
  const p = { id: 1, name: "acme", path: STORE, storagePath: STORE };
  const projects = { list: () => [p], get: () => p };
  const asAuditor = commentTask.makeHandler({ projects, channelMeta: { agentSlug: "auditor" }, globalConfig: {}, plugins: null });
  const asked = await asAuditor({ task: t.id, project: "1", decision: { question: "¿PM corrige §3?", responsible: "pm" } });
  assert.equal(asked.ok, true);
  const did = asked.decision.id;

  const asPm = commentTask.makeHandler({ projects, channelMeta: { agentSlug: "pm" }, globalConfig: {}, plugins: null });
  const answered = await asPm({ task: t.id, project: "1", answers_decision: did, text: "Sí, hoy" });
  assert.equal(answered.ok, true);
  assert.equal(answered.decision.state, "answered");
  assert.match(answered.note, /not approved/);
});
