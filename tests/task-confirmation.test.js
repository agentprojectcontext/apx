// What the owner is asked to approve when an agent moves or edits a task or a
// commitment — and that a call the tool would refuse never asks at all.
//
// The handlers used to hand the confirmation only the id (`{ task, action }`,
// `{ task }`), so the owner read "Task t_…: move to ?" and "Edit task t_…:
// (nothing)" and could not tell what they were approving. And the checks ran
// AFTER the question, so a call with no status still asked first, then failed.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-taskconfirm-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx"); // HOME alone is overridden by the runner's APX_HOME

const completeTask = (await import("#core/agent/tools/handlers/complete-task.js")).default;
const updateTask = (await import("#core/agent/tools/handlers/update-task.js")).default;
const markCommitment = (await import("#core/agent/tools/handlers/mark-commitment.js")).default;
const updateCommitment = (await import("#core/agent/tools/handlers/update-commitment.js")).default;
const { createPermissionGuard } = await import("#core/agent/tools/helpers.js");
const { makeToolHandlers } = await import("#core/agent/tools/registry.js");
const { runAgent } = await import("#core/agent/run-agent.js");
const { createTask, getTask } = await import("#core/stores/tasks.js");
const { createCommitment } = await import("#core/stores/commitments.js");

let storage, projects, asked, ctx;

beforeEach(() => {
  storage = fs.mkdtempSync(path.join(TMP_HOME, "store-"));
  const entry = { id: 0, name: "acme", path: "/path/to/acme", storagePath: storage };
  projects = { list: () => [entry], get: (id) => (String(id) === "0" ? entry : null) };
  asked = [];
  // `permiso` with nothing allowlisted: every one of these tools asks.
  const requirePermission = createPermissionGuard(
    { super_agent: { permission_mode: "permiso", allowed_tools: [] } },
    { requestConfirmation: async (tool, _args, description) => { asked.push({ tool, description }); return true; } },
  );
  ctx = { projects, requirePermission };
});

// ── What the question says ──────────────────────────────────────────────────

test("complete_task action=status: the question names the task and the move from → to", async () => {
  const t = createTask(storage, { title: "Send the Northwind invoice" });
  const r = await completeTask.makeHandler(ctx)({ task: t.id, action: "status", status: "blocked" });
  assert.equal(r.ok, true);
  assert.equal(asked.length, 1);
  const { description } = asked[0];
  assert.match(description, new RegExp(t.id));
  assert.match(description, /Send the Northwind invoice/);
  assert.match(description, /move from pending to blocked/);
  assert.doesNotMatch(description, /\?/);
});

test("complete_task action=done: the question names the task", async () => {
  const t = createTask(storage, { title: "Renew the domain" });
  await completeTask.makeHandler(ctx)({ task: t.id, action: "done" });
  assert.match(asked[0].description, /Renew the domain/);
  assert.match(asked[0].description, /mark done/);
});

test("update_task: the question lists each edited field with its new value", async () => {
  const t = createTask(storage, { title: "Call the accountant" });
  const r = await updateTask.makeHandler(ctx)({ task: t.id, due: "2026-11-02", priority: "urgent", agent: "" });
  assert.equal(r.ok, true);
  assert.equal(asked.length, 1);
  const { description } = asked[0];
  assert.match(description, /Call the accountant/);
  assert.match(description, /due → "2026-11-02"/);
  assert.match(description, /priority → "urgent"/);
  assert.match(description, /agent cleared/);
  assert.doesNotMatch(description, /\(nothing\)/);
});

test("update_commitment: the question lists what is corrected", async () => {
  const c = createCommitment(storage, { counterparty: "Acme", body: "send the deck" });
  await updateCommitment.makeHandler(ctx)({ commitment: c.id, counterparty: "Northwind" });
  assert.match(asked[0].description, /send the deck/);
  assert.match(asked[0].description, /counterparty → "Northwind"/);
});

test("mark_commitment renegotiate: the question says the old and the new date", async () => {
  const c = createCommitment(storage, { counterparty: "Acme", body: "ship the report", due: "2026-10-20" });
  await markCommitment.makeHandler(ctx)({ commitment: c.id, action: "renegotiate", due: "2026-10-27" });
  assert.match(asked[0].description, /ship the report/);
  assert.match(asked[0].description, /renegotiate from 2026-10-20 to 2026-10-27/);
});

// ── A call that would fail does not ask ─────────────────────────────────────

test("complete_task with no status never asks, and the error names the missing field", async () => {
  const t = createTask(storage, { title: "x" });
  const r = await completeTask.makeHandler(ctx)({ task: t.id, action: "status" });
  assert.equal(asked.length, 0);
  assert.match(r.error, /status required/);
  assert.match(r.error, /pending/); // the columns it could have used
  assert.equal(getTask(storage, t.id).status, "pending");
});

test("complete_task with an unknown status never asks", async () => {
  const t = createTask(storage, { title: "x" });
  const r = await completeTask.makeHandler(ctx)({ task: t.id, action: "status", status: "someday" });
  assert.equal(asked.length, 0);
  assert.match(r.error, /unknown status "someday"/);
});

test("complete_task on a task that does not exist never asks", async () => {
  const r = await completeTask.makeHandler(ctx)({ task: "t_zzzzzz", action: "done" });
  assert.equal(asked.length, 0);
  assert.match(r.error, /task not found: t_zzzzzz/);
});

test("complete_task with no action never asks, and says action is required", async () => {
  const t = createTask(storage, { title: "x" });
  const r = await completeTask.makeHandler(ctx)({ task: t.id });
  assert.equal(asked.length, 0);
  assert.match(r.error, /action required/);
});

test("update_task with nothing to change never asks", async () => {
  const t = createTask(storage, { title: "x" });
  const r = await updateTask.makeHandler(ctx)({ task: t.id });
  assert.equal(asked.length, 0);
  assert.match(r.error, /nothing to update/);
});

test("update_task with an invalid value never asks", async () => {
  const t = createTask(storage, { title: "x" });
  const r = await updateTask.makeHandler(ctx)({ task: t.id, priority: "very urgent" });
  assert.equal(asked.length, 0);
  assert.match(r.error, /unknown priority/);
});

test("mark_commitment renegotiate with no date never asks", async () => {
  const c = createCommitment(storage, { counterparty: "Acme", body: "call back" });
  const r = await markCommitment.makeHandler(ctx)({ commitment: c.id, action: "renegotiate" });
  assert.equal(asked.length, 0);
  assert.match(r.error, /due required/);
});

test("update_commitment with nothing to change never asks", async () => {
  const c = createCommitment(storage, { counterparty: "Acme", body: "call back" });
  const r = await updateCommitment.makeHandler(ctx)({ commitment: c.id });
  assert.equal(asked.length, 0);
  assert.match(r.error, /nothing to update/);
});

// ── The security-risk gate in the loop asks before the handler runs ──────────

async function runRiskGated(args) {
  const confirmations = [];
  const globalConfig = {
    super_agent: {
      enabled: true,
      model: "mock:test",
      permission_mode: "automatico",
      model_fallback: { enabled: false },
      // The mock emits no grade → UNKNOWN → this gate asks.
      security_risk: { enabled: true, confirm_at: "HIGH", confirm_unknown: true },
    },
    engines: {},
  };
  const toolHandlerCtx = {
    globalConfig,
    projects,
    requestConfirmation: async (tool, _args, description) => { confirmations.push({ tool, description }); return true; },
  };
  const result = await runAgent({
    globalConfig,
    system: "sys",
    prompt: `[mock:tool:complete_task] [mock:args:${JSON.stringify(args)}] do it`,
    toolSchemas: [completeTask.schema],
    makeToolHandlers,
    toolHandlerCtx,
    maxIters: 3,
  });
  return { confirmations, item: result.trace.find((t) => t.tool === "complete_task") };
}

test("risk gate: a valid move is described by the tool, with the task and from → to", async () => {
  const t = createTask(storage, { title: "Review the Acme contract" });
  const { confirmations, item } = await runRiskGated({ task: t.id, action: "status", status: "in_review" });
  assert.equal(confirmations.length, 1, "asked once — the handler's own guard stands down after the gate");
  assert.match(confirmations[0].description, /Review the Acme contract/);
  assert.match(confirmations[0].description, /move from pending to in_review/);
  assert.equal(item.result.ok, true);
  assert.equal(getTask(storage, t.id).status, "in_review");
});

test("risk gate: a move with no status is refused without asking", async () => {
  const t = createTask(storage, { title: "x" });
  const { confirmations, item } = await runRiskGated({ task: t.id, action: "status" });
  assert.equal(confirmations.length, 0);
  assert.match(String(item.result.error), /status required/);
});

test("risk gate: a task that does not exist is refused without asking", async () => {
  const { confirmations, item } = await runRiskGated({ task: "t_zzzzzz", action: "done" });
  assert.equal(confirmations.length, 0);
  assert.match(String(item.result.error), /task not found/);
});
