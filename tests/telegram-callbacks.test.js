// Inline-keyboard button presses (callback_query) on Telegram.
//
// The Telegram contract: EVERY callback_query must be answered. Until
// answerCallbackQuery is called the client keeps the button spinning, so an
// unanswered press is reported as "the buttons don't work / nothing happens".
//
// Two ways APX used to leave a press unanswered or inert:
//   1. callback_data it didn't recognise fell through to a log line and no ack
//      at all — the button span forever.
//   2. an ask_questions press whose flow had died (ask state is process-local,
//      so a daemon restart or the 30-min TTL kills it) was ack'd silently: the
//      keyboard stayed in the chat and every tap did nothing, with no
//      explanation.
//
// These tests drive the real handler with a fake poller that records the
// Telegram calls it would make.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Mobility alerts persist to ~/.apx/mobility.json, so this file needs its OWN
// APX_HOME before the state module is imported and freezes that path. HOME
// alone is not enough — computeHome() reads APX_HOME first, and a test that
// only moves HOME writes into the shared run sandbox and races every other
// test that does the same (AGENTS.md rule 1). Set before the dynamic imports
// below for the same reason: a static import would run first.
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "apx-tg-callbacks-"));
process.env.APX_HOME = path.join(tmpHome, ".apx");
process.env.HOME = tmpHome;
process.env.USERPROFILE = tmpHome;

const { handleCallbackQuery, buttonLabelFor } = await import("#core/channels/telegram/ask-callbacks.js");
const { listDeliveries, DELIVERY_STATUS } = await import("#core/stores/deliveries.js");
const { createTask, getTask } = await import("#core/stores/tasks.js");
const { _resetMobilityStateForTest, getMobilityAlert, recordMobilityAlert } =
  await import("#core/mobility/state.js");

test.after(() => fs.rmSync(tmpHome, { recursive: true, force: true }));

function fakePoller(storagePath = null) {
  const calls = { answers: [], keyboards: [], updates: [], logs: [], sends: [] };
  return {
    calls,
    channel: { name: "default", bot_token: "test-token" },
    globalConfig: {},
    log: (m) => calls.logs.push(m),
    async _answerCallback(a) { calls.answers.push(a); },
    async _editKeyboard(k) { calls.keyboards.push(k); },
    async _handleUpdate(u) { calls.updates.push(u); },
    resolveProject() { return storagePath ? { id: "default", storagePath } : null; },
    projects: { get: () => (storagePath ? { id: "default", storagePath } : null) },
    async _send(message) { calls.sends.push(message); return { message_id: 1 }; },
  };
}

test("mobility remind-later button enters the delivery queue", async () => {
  const storagePath = fs.mkdtempSync(path.join(os.tmpdir(), "apx-mobility-delivery-"));
  const self = fakePoller(storagePath);
  const press = pressOf("apx:mobility:later");
  press.message.text = "Pasá por La Anónima";
  await handleCallbackQuery(self, press);
  const rows = listDeliveries(storagePath, { status: DELIVERY_STATUS.PENDING });
  assert.equal(rows.length, 1);
  assert.match(rows[0].notify, /La Anónima/);
  assert.equal(self.calls.keyboards.length, 1);
  assert.match(self.calls.sends[0].text, /próxima ronda/i);
});

function pressOf(data, { label = "", chatId = 4242 } = {}) {
  return {
    id: "cbq_1",
    from: { id: 7, first_name: "Manu" },
    data,
    message: {
      message_id: 99,
      chat: { id: chatId, type: "private" },
      reply_markup: label
        ? { inline_keyboard: [[{ text: label, callback_data: data }]] }
        : undefined,
    },
  };
}

test("an unrecognised button is answered, never left spinning", async () => {
  const self = fakePoller();
  await handleCallbackQuery(self, pressOf("mover_workspace_hoy", { label: "Mover al workspace de hoy" }));
  assert.equal(self.calls.answers.length, 1, "the press must be answered");
  assert.equal(self.calls.answers[0].callback_query_id, "cbq_1");
});

test("an unrecognised button becomes a user turn, using the label the human read", async () => {
  const self = fakePoller();
  await handleCallbackQuery(self, pressOf("mover_workspace_hoy", { label: "Mover al workspace de hoy" }));
  assert.equal(self.calls.updates.length, 1, "the press should re-enter the normal inbound path");
  const msg = self.calls.updates[0].message;
  assert.equal(msg.text, "Mover al workspace de hoy", "the label, not the slug");
  assert.equal(msg.chat.id, 4242);
  assert.equal(msg.from.id, 7, "the presser's identity is preserved for role gating");
  // Ack must come BEFORE the turn: the agent can take seconds, the spinner can't.
  assert.equal(self.calls.answers.length, 1);
});

test("a button with no label falls back to its callback_data", async () => {
  const self = fakePoller();
  await handleCallbackQuery(self, pressOf("crear_tarea_nueva"));
  assert.equal(self.calls.updates[0].message.text, "crear_tarea_nueva");
});

test("apx: presses are never replayed to the agent", async () => {
  // A dead confirmation button. Acking is required; re-asking the agent is not
  // — that question is already closed.
  const self = fakePoller();
  await handleCallbackQuery(self, pressOf("apx:noop"));
  assert.equal(self.calls.answers.length, 1, "still answered");
  assert.equal(self.calls.updates.length, 0, "but not turned into a turn");
  assert.equal(self.calls.keyboards.length, 1, "and the dead keyboard is removed");
  assert.deepEqual(self.calls.keyboards[0].reply_markup, { inline_keyboard: [] });
});

test("a press from an ask flow that no longer exists says so and clears the keyboard", async () => {
  // No flow was ever started for this chat — the same state a daemon restart
  // leaves behind. Previously: silent ack, keyboard intact, tap does nothing.
  const self = fakePoller();
  await handleCallbackQuery(self, pressOf("apx:ask:abc123:opt:0"));
  assert.equal(self.calls.answers.length, 1);
  assert.match(
    self.calls.answers[0].text || "",
    /expir/i,
    "the user is told why the tap did nothing"
  );
  assert.equal(self.calls.keyboards.length, 1, "dead keyboard removed");
  assert.deepEqual(self.calls.keyboards[0].reply_markup, { inline_keyboard: [] });
  assert.equal(self.calls.updates.length, 0, "an expired ask is not a new turn");
});

test("buttonLabelFor picks the tapped button out of the keyboard", () => {
  const q = {
    data: "b",
    message: {
      reply_markup: {
        inline_keyboard: [
          [{ text: "Uno", callback_data: "a" }, { text: "Dos", callback_data: "b" }],
          [{ text: "Cerrar", callback_data: "c" }],
        ],
      },
    },
  };
  assert.equal(buttonLabelFor(q), "Dos");
  assert.equal(buttonLabelFor({ data: "zzz", message: q.message }), "");
  assert.equal(buttonLabelFor({}), "");
});

// ---------------------------------------------------------------------------
// Proximity chips — the alert-scoped half of apx:mobility:*
// ---------------------------------------------------------------------------

test("a proximity yes is recorded as a promise, not acted on yet", async () => {
  _resetMobilityStateForTest();
  const self = fakePoller();
  const alert = recordMobilityAlert({ trip_id: "trip-1", task_id: "t1", task: "Comprar remedios", place: "Farmacia Ejemplo" });
  await handleCallbackQuery(self, pressOf(`apx:mobility:go:${alert.id}`));

  assert.equal(getMobilityAlert(alert.id).answer, "go");
  assert.equal(getMobilityAlert(alert.id).outcome, null, "the task is closed by the follow-up, not by the yes");
  assert.equal(self.calls.answers.length, 1, "every press must be answered or the button spins");
  // The fake poller carries no user language, so the ack lands in the default
  // locale — which is the point: the label is host-emitted and localized.
  assert.match(self.calls.answers[0].text, /you're going/i);
  assert.equal(self.calls.keyboards.length, 1, "the dead keyboard is cleared");
});

test("a proximity no closes the alert without touching the task", async () => {
  _resetMobilityStateForTest();
  const storagePath = fs.mkdtempSync(path.join(os.tmpdir(), "apx-mobility-skip-"));
  const self = fakePoller(storagePath);
  const task = createTask(storagePath, { title: "Comprar remedios" });
  const alert = recordMobilityAlert({ trip_id: "trip-2", task_id: task.id, project_id: "default", place: "Farmacia Ejemplo" });

  await handleCallbackQuery(self, pressOf(`apx:mobility:skip:${alert.id}`));
  assert.equal(getMobilityAlert(alert.id).outcome, "skipped");
  assert.equal(getTask(storagePath, task.id).state, "open");
});

test("the follow-up's done button actually closes the task it was about", async () => {
  _resetMobilityStateForTest();
  const storagePath = fs.mkdtempSync(path.join(os.tmpdir(), "apx-mobility-done-"));
  const self = fakePoller(storagePath);
  const task = createTask(storagePath, { title: "Comprar remedios" });
  const alert = recordMobilityAlert({ trip_id: "trip-3", task_id: task.id, project_id: "default", place: "Farmacia Ejemplo" });

  await handleCallbackQuery(self, pressOf(`apx:mobility:done:${alert.id}`));
  assert.equal(getTask(storagePath, task.id).state, "done");
  assert.equal(getMobilityAlert(alert.id).outcome, "done");

  // "not yet" leaves it open — the reminder was useful, the errand was not done.
  const other = recordMobilityAlert({ trip_id: "trip-3", task_id: task.id, project_id: "default", place: "Otra Farmacia" });
  await handleCallbackQuery(self, pressOf(`apx:mobility:open:${other.id}`));
  assert.equal(getMobilityAlert(other.id).outcome, "still_open");
});

test("a press on an alert the daemon no longer has is answered, not ignored", async () => {
  _resetMobilityStateForTest();
  const self = fakePoller();
  await handleCallbackQuery(self, pressOf("apx:mobility:go:mbgone"));
  assert.equal(self.calls.answers.length, 1);
  assert.equal(self.calls.keyboards.length, 1);
  assert.match(self.calls.logs.join(" "), /mbgone is gone/);
});
