// A Telegram turn sends ONE notice, works, and then answers.
//
// Regression: the super-agent gets 24 tool steps on Telegram and writes a short
// line before each one, and the stream handler used to forward every one of
// them — a single request arrived as eight chat messages, i.e. eight push
// notifications for one task. These tests pin the policy (progress-gate.js) and
// the wiring (buildStreamHandler): the model's own opening line goes out, the
// notes before later steps are held, only a long silence buys one more, and
// nothing is ever written on the agent's behalf.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Per-test APX home: buildStreamHandler writes to the message ledger under it.
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "apx-tg-progress-"));
process.env.HOME = tmpHome;
process.env.USERPROFILE = tmpHome;

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

test("gate: only the model opens a turn — tool calls buy no message of their own", () => {
  // Tool steps are not events this gate reacts to at all: nothing is written on
  // the agent's behalf, so a turn that opened straight into a tool is still
  // unopened, and the first line the model writes is its opener.
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

/** Poller stub: records what would have been sent to the chat. */
function makePoller(superAgentCfg = {}) {
  const sent = [];
  return {
    sent,
    self: {
      globalConfig: { super_agent: superAgentCfg },
      channel: { name: "default" },
      log: () => {},
      _send: async ({ text }) => { sent.push(text); },
    },
  };
}

const toolStart = (n) => ({
  type: "tool_start",
  trace: { id: `1:${n}`, tool: "list_tasks", args: {}, pending: true },
  iteration: n,
});

test("stream: a seven-step turn sends ONE message, not seven", async () => {
  const { self, sent } = makePoller({ telegram_progress_every_s: 90 });
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

  assert.deepEqual(sent, ["Reviso eso"], "only the opening notice reaches the chat");
  assert.equal(state.streamedCount, 1);
  assert.equal(state.lastStreamedText, "Reviso eso");
  assert.equal(state.heldCount, 7, "every later note is accounted for, not silently dropped");
});

test("stream: a turn that starts with tools says nothing until the model does", async () => {
  const { self, sent } = makePoller({ telegram_progress_every_s: 90 });
  const { onEvent, state } = buildStreamHandler(self, {
    chat_id: "1234567890",
    update_id: 43,
    agentDisplay: "APX",
  });

  await onEvent(toolStart(1));
  await onEvent(toolStart(2));
  await onEvent({ type: "assistant_text", text: "Sigo buscando", iteration: 2 });

  assert.deepEqual(sent, ["Sigo buscando"], "no canned notice precedes the model's own words");
  assert.equal(state.streamedCount, 1, "what reached the chat is model prose, all of it");
  assert.equal(state.heldCount, 0);
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
