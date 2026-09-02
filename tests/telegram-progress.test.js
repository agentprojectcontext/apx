// A Telegram turn opens with the model's own line, works quietly, then answers.
//
// The thing most of these pin is a NEGATIVE: no tool name ever reaches the chat.
// It briefly did — one "⚙️ run_shell" per tool start — and Telegram is a
// conversation, so machine vocabulary in it is a bug however truthful it is.
// What carries the work is the typing indicator, renewed on each tool start.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Per-test APX home: buildStreamHandler writes to the message ledger under it.
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "apx-tg-progress-"));
process.env.HOME = tmpHome;
process.env.USERPROFILE = tmpHome;
process.env.APX_HOME = path.join(tmpHome, ".apx"); // isolate the apx home too — HOME alone is overridden by the runner's APX_HOME

const { createProgressGate, progressEveryMs, DEFAULT_PROGRESS_EVERY_S } = await import(
  "../src/core/channels/telegram/progress-gate.js"
);
const { buildStreamHandler } = await import("../src/core/channels/telegram/reply.js");

// ── the policy ─────────────────────────────────────────────────────────────

test("gate: the model's first line opens the turn, later ones are held", () => {
  const gate = createProgressGate({ everyMs: 90_000, now: () => 1_000 });
  assert.equal(gate.text(), "send", "the opening line is the turn's one notice");
  assert.equal(gate.text(), "hold");
  assert.equal(gate.text(), "hold");
});

test("gate: tool activity does not consume the optional model opener", () => {
  // Tool activity is emitted by buildStreamHandler. This pure gate still owns
  // only model-authored optional prose.
  const gate = createProgressGate({ everyMs: 90_000, now: () => 1_000 });
  assert.equal(gate.sinceLastMs(), 0, "no tool step has spent the opener");
  assert.equal(gate.text(), "send", "the model's own line is the turn's first message");
  assert.equal(gate.text(), "hold", "one opener per turn");
});

test("gate: a long silence buys exactly one more note", () => {
  let clock = 0;
  const gate = createProgressGate({ everyMs: 90_000, now: () => clock });
  assert.equal(gate.text(), "send");         // opener at t=0
  clock = 89_000;
  assert.equal(gate.text(), "hold", "still inside the quiet window");
  clock = 90_000;
  assert.equal(gate.text(), "send", "silence reached the heartbeat — show a sign of life");
  clock = 91_000;
  assert.equal(gate.text(), "hold", "and the window restarts from that message");
});

test("gate: everyMs 0 means strictly notice → work → answer", () => {
  let clock = 0;
  const gate = createProgressGate({ everyMs: 0, now: () => clock });
  assert.equal(gate.text(), "send");
  clock = 10 * 60_000;
  assert.equal(gate.text(), "hold", "no heartbeat when it is switched off");
});

test("gate: sinceLastMs measures quiet time for the log line", () => {
  let clock = 5_000;
  const gate = createProgressGate({ everyMs: 90_000, now: () => clock });
  assert.equal(gate.sinceLastMs(), 0, "nothing sent yet");
  gate.text();
  clock = 17_000;
  assert.equal(gate.sinceLastMs(), 12_000);
});

test("progressEveryMs: unset falls back to the default, 0 disables", () => {
  assert.equal(progressEveryMs(undefined), DEFAULT_PROGRESS_EVERY_S * 1000);
  assert.equal(progressEveryMs({ super_agent: {} }), DEFAULT_PROGRESS_EVERY_S * 1000);
  assert.equal(progressEveryMs({ super_agent: { telegram_progress_every_s: 30 } }), 30_000);
  assert.equal(progressEveryMs({ super_agent: { telegram_progress_every_s: 0 } }), 0);
  assert.equal(progressEveryMs({ super_agent: { telegram_progress_every_s: "45" } }), 45_000);
  assert.equal(
    progressEveryMs({ super_agent: { telegram_progress_every_s: "nonsense" } }),
    0,
    "an unusable value must not resurrect the spam — quiet is the safe reading",
  );
});

// ── the wiring ─────────────────────────────────────────────────────────────

/** Poller stub: records what would have been sent to the chat, and every time
 *  the typing indicator was renewed. */
function makePoller(superAgentCfg = {}) {
  const sent = [];
  const typing = [];
  return {
    sent,
    typing,
    self: {
      globalConfig: { super_agent: superAgentCfg },
      channel: { name: "default" },
      log: () => {},
      _send: async ({ text }) => { sent.push(text); },
      _typing: async (chatId) => { typing.push(chatId); },
    },
  };
}

const toolStart = (n) => ({
  type: "tool_start",
  trace: { id: `1:${n}`, tool: "list_tasks", args: {}, pending: true },
  iteration: n,
});

test("stream: seven tools cost one message — the model's opening line", async () => {
  const { self, sent, typing } = makePoller({ telegram_progress_every_s: 90 });
  const { onEvent, state } = buildStreamHandler(self, {
    chat_id: "1234567890",
    update_id: 42,
    agentDisplay: "APX",
  });

  await onEvent({ type: "model_start", iteration: 1, model: "mock:test" });
  await onEvent({ type: "assistant_text", text: "Reviso eso", iteration: 1 });
  for (let i = 1; i <= 7; i++) {
    await onEvent(toolStart(i));
    await onEvent({ type: "assistant_text", text: `Paso ${i}`, iteration: i + 1 });
  }

  assert.deepEqual(sent, ["Reviso eso"], "one opener, then quiet until the answer");
  assert.equal(state.streamedCount, 1);
  assert.equal(state.lastStreamedText, "Reviso eso");
  assert.equal(state.heldCount, 7, "every later note is accounted for, not silently dropped");
  assert.equal(typing.length, 7, "each tool start refreshes the typing indicator instead");
});

test("stream: no tool name ever reaches the chat, whatever the tool is called", async () => {
  // The regression, stated as the promise it broke: Telegram is prose. A turn
  // that shells out does not get to say "run_shell" — not with a gear in front
  // of it, not at all.
  const { self, sent } = makePoller({ telegram_progress_every_s: 90 });
  const { onEvent } = buildStreamHandler(self, {
    chat_id: "1234567890",
    update_id: 45,
    agentDisplay: "APX",
  });

  await onEvent({ type: "assistant_text", text: "Reviso eso", iteration: 1 });
  for (const tool of ["run_shell", "asana_list_projects", "send_telegram"]) {
    await onEvent({ type: "tool_start", trace: { id: `1:${tool}`, tool, args: {}, pending: true }, iteration: 1 });
    await onEvent({ type: "tool_result", trace: { id: `1:${tool}`, tool, args: {}, result: "ok" }, iteration: 1 });
  }

  assert.deepEqual(sent, ["Reviso eso"]);
  const joined = sent.join("\n");
  assert.doesNotMatch(joined, /⚙️/, "no gear prefix");
  assert.doesNotMatch(joined, /run_shell|asana_list_projects|send_telegram/, "no tool identifiers");
});

test("stream: a turn that dives straight into tools stays quiet until the model speaks", async () => {
  // Nothing is written on the agent's behalf. The owner sees the typing
  // indicator until the model itself has something to say.
  const { self, sent, typing } = makePoller({ telegram_progress_every_s: 90 });
  const { onEvent, state } = buildStreamHandler(self, {
    chat_id: "1234567890",
    update_id: 43,
    agentDisplay: "APX",
  });

  await onEvent(toolStart(1));
  await onEvent(toolStart(2));
  assert.deepEqual(sent, [], "two tools in, still not a word");
  assert.equal(typing.length, 2, "but the chat is visibly working");

  await onEvent({ type: "assistant_text", text: "Sigo buscando", iteration: 2 });
  assert.deepEqual(sent, ["Sigo buscando"], "the model's line is the first thing sent");
  assert.equal(state.streamedCount, 1);
  assert.equal(state.heldCount, 0, "tools did not spend the opener");
});

test("stream: a turn that never calls a tool is untouched", async () => {
  const { self, sent } = makePoller({ telegram_progress_every_s: 90 });
  const { onEvent, state } = buildStreamHandler(self, {
    chat_id: "1234567890",
    update_id: 44,
    agentDisplay: "APX",
  });

  // No tools → the loop emits no assistant_text at all; the whole reply is the
  // final send, which this handler never gates.
  await onEvent({ type: "model_start", iteration: 1, model: "mock:test" });
  assert.deepEqual(sent, []);
  assert.equal(state.heldCount, 0);
});
