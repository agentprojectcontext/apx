// Every routine uses a high runaway ceiling. Non-Telegram routines still keep a
// separate override because their delivery contract is different.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  routineReportsToTelegram,
  routineToolIters,
} from "#core/routines/runner.js";
import {
  TELEGRAM_TOOL_ITERS,
  ROUTINE_UNCAPPED_TOOL_ITERS,
} from "#core/agent/constants.js";

test("routineReportsToTelegram — telegram post_command (send_telegram suppressed) counts", () => {
  // A `apx telegram send` post_command shows up as a suppressed send_telegram.
  assert.equal(routineReportsToTelegram({ autoSuppress: ["send_telegram"] }), true);
});

test("routineReportsToTelegram — send_telegram merely being available does NOT count", () => {
  // The broad default tool set carries send_telegram; a background routine (Magui
  // with post_commands:[] and allowed_tools:[]) must not be read as telegram-bound
  // just because it *could* send a summary.
  assert.equal(routineReportsToTelegram({ autoSuppress: [] }), false);
});

test("routineReportsToTelegram — no telegram post_command is background work", () => {
  assert.equal(routineReportsToTelegram({ autoSuppress: ["say_voice"] }), false);
});

test("routineToolIters — telegram-bound uses its own high safety ceiling", () => {
  assert.equal(routineToolIters({}, { telegramBound: true }), TELEGRAM_TOOL_ITERS);
});

test("routineToolIters — non-telegram runs to completion (uncapped ceiling)", () => {
  assert.equal(routineToolIters({}, { telegramBound: false }), ROUTINE_UNCAPPED_TOOL_ITERS);
  assert.ok(ROUTINE_UNCAPPED_TOOL_ITERS >= TELEGRAM_TOOL_ITERS);
});

test("routineToolIters — config overrides both budgets when set > 0", () => {
  const cfg = { super_agent: { telegram_max_iters: 40, routine_max_iters: 300 } };
  assert.equal(routineToolIters(cfg, { telegramBound: true }), 40);
  assert.equal(routineToolIters(cfg, { telegramBound: false }), 300);
});

test("routineToolIters — 0 / invalid override falls back to the built-in", () => {
  const cfg = { super_agent: { telegram_max_iters: 0, routine_max_iters: -5 } };
  assert.equal(routineToolIters(cfg, { telegramBound: true }), TELEGRAM_TOOL_ITERS);
  assert.equal(routineToolIters(cfg, { telegramBound: false }), ROUTINE_UNCAPPED_TOOL_ITERS);
});
