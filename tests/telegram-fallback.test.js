// Regression tests for the Telegram reply path. When the super-agent throws
// (non-abort), the bot must surface a localized error instead of dropping the
// turn silently; and an empty final turn must never end on silence. Both the
// inbound dispatcher AND the ask-flow resume drive the SAME shared reply path
// (core/channels/telegram/reply.js) — these tests guard that the behavior lives
// there and that both entry points actually use it (it drifted once already).
//
// We don't exercise the real plugin (needs a live Telegram channel + many
// stubs). We read the source and assert the code paths are present.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => fs.readFileSync(path.join(__dirname, "..", "src", ...p), "utf8");

const DISPATCH = read("core", "channels", "telegram", "dispatch.js");
const REPLY = read("core", "channels", "telegram", "reply.js");
// The ask-flow resume (the second entry point into the reply path) lives here.
const ASK_CALLBACKS = read("core", "channels", "telegram", "ask-callbacks.js");

test("telegram: super-agent catch surfaces a reply on non-abort errors", () => {
  // The dispatcher's super-agent catch must assign replyText (not just log +
  // return), delegating the wording to the shared localized error helper.
  const block = DISPATCH.match(/super-agent failed: \$\{e\.message\}[\s\S]{0,400}/);
  assert.ok(block, "super-agent failed log line must be present");
  assert.match(
    block[0],
    /replyText\s*=\s*telegramErrorText\(/,
    "non-abort errors must set replyText via the shared localized error helper",
  );
  // And that helper must route through i18n, not a hardcoded English literal.
  assert.match(
    REPLY,
    /telegramErrorText[\s\S]{0,200}telegram\.error_generic/,
    "telegramErrorText must use the localized error key",
  );
});

test("telegram: empty final text never ends the turn silently", () => {
  // The never-silent floor lives in sendFinalReply (reply.js). Two layers, in
  // this order: the model is asked to write the closing from what the turn did,
  // and the canned line is what goes out only if that comes back empty too.
  // The behaviour is exercised in telegram-closing.test.js; what this pins is
  // that the floor itself is still there and still layered that way.
  const floor = REPLY.match(/}\s*else if \(!finalClean\) \{[\s\S]{0,1800}?\n {2}\}/);
  assert.ok(floor, "sendFinalReply must have an `else if (!finalClean)` floor branch");
  assert.match(floor[0], /authorLineFn\(/, "the closing is the model's to word first");
  assert.match(floor[0], /telegram\.fallback_continue/, "cut-off turn falls back to the neutral continue prompt");
  assert.match(floor[0], /telegram\.fallback_listo/, "pure chit-chat turn falls back to the short ack");
  assert.ok(
    floor[0].indexOf("authorLineFn(") < floor[0].indexOf("telegram.fallback"),
    "canned text is the floor, not the first answer",
  );
});

test("telegram: the /reset ack is written by the model, canned only as a floor", () => {
  // Same rule as the closing: the host decides an ack is due, the model decides
  // how it reads. A reset engages no engine for the TURN — this one call is not
  // that turn, it is the confirmation, and it still has a floor under it.
  const reset = DISPATCH.match(/if \(isReset\) \{[\s\S]{0,900}?telegram\.reset_ack[^\n]*/);
  assert.ok(reset, "the reset short-circuit must still produce an ack");
  assert.match(reset[0], /authorLine\(/, "the ack is asked for, not stored");
  assert.ok(
    reset[0].indexOf("authorLine(") < reset[0].indexOf("telegram.reset_ack"),
    "the canned ack is what runs when the model cannot answer, not before it",
  );
});

test("telegram: both entry points share the reply path (no drift)", () => {
  // The whole point of reply.js: the inbound dispatcher and the ask-flow resume
  // must BOTH run the super-agent through runTelegramSuperAgent and close with
  // sendFinalReply — so the autonomy budget, streaming and never-silent floor
  // can't silently lag behind in one of them (the resume path drifted before).
  for (const [name, src] of [["dispatch.js", DISPATCH], ["ask-callbacks.js (runResumedTurn)", ASK_CALLBACKS]]) {
    assert.match(src, /runTelegramSuperAgent\(/, `${name} must run via the shared runTelegramSuperAgent`);
    assert.match(src, /sendFinalReply\(/, `${name} must close via the shared sendFinalReply`);
  }
});

test("telegram: aborted requests still short-circuit silently", () => {
  // The abort path must remain a silent return — interrupting the user's own
  // request shouldn't generate a "could not reply" message.
  const abortBlock = DISPATCH.match(/if \(abortCtrl\.signal\.aborted\) \{[\s\S]{0,600}?return;/);
  assert.ok(abortBlock, "abort branch must exist");
  assert.match(abortBlock[0], /return;/, "abort path must return");
  assert.doesNotMatch(abortBlock[0], /replyText\s*=/, "abort path must NOT set a reply — interrupting is silent");
});

test("telegram: the poll loop does not await the model turn", () => {
  // Default Interrupt (abort the previous AbortController) only fires if
  // getUpdates keeps running while a turn is in flight. handleUpdate used to
  // await the whole super-agent, which froze polling — a newer message sat in
  // Telegram's queue until the zombie run finished, then each queued message
  // ran sequentially. The reply turn is now detached.
  assert.match(DISPATCH, /const replyTurn = \(async \(\) => \{/);
  assert.match(DISPATCH, /replyTurn\.catch\(/);
  assert.match(DISPATCH, /releaseActiveRequest\(/);
});
