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
const HOST = read("host", "daemon", "plugins", "telegram", "index.js");

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
  // The never-silent floor lives in sendFinalReply (reply.js): a turn that
  // streamed/acted but produced no closing gets a neutral "continue?"; a pure
  // chit-chat turn that did nothing gets the short ack.
  const floor = REPLY.match(/}\s*else if \(!finalClean\) \{[\s\S]{0,600}?\n {2}\}/);
  assert.ok(floor, "sendFinalReply must have an `else if (!finalClean)` floor branch");
  assert.match(floor[0], /telegram\.fallback_continue/, "cut-off turn gets the neutral continue prompt");
  assert.match(floor[0], /telegram\.fallback_listo/, "pure chit-chat turn still gets the short ack");
});

test("telegram: both entry points share the reply path (no drift)", () => {
  // The whole point of reply.js: the inbound dispatcher and the ask-flow resume
  // must BOTH run the super-agent through runTelegramSuperAgent and close with
  // sendFinalReply — so the autonomy budget, streaming and never-silent floor
  // can't silently lag behind in one of them (the resume path drifted before).
  for (const [name, src] of [["dispatch.js", DISPATCH], ["host index.js (_runResumedTurn)", HOST]]) {
    assert.match(src, /runTelegramSuperAgent\(/, `${name} must run via the shared runTelegramSuperAgent`);
    assert.match(src, /sendFinalReply\(/, `${name} must close via the shared sendFinalReply`);
  }
});

test("telegram: aborted requests still short-circuit silently", () => {
  // The abort path must remain a silent return — interrupting the user's own
  // request shouldn't generate a "could not reply" message.
  const abortBlock = DISPATCH.match(/if \(abortCtrl\.signal\.aborted\) \{[\s\S]{0,400}?\n {8}\}/);
  assert.ok(abortBlock, "abort branch must exist");
  assert.match(abortBlock[0], /return;/, "abort path must return");
  assert.doesNotMatch(abortBlock[0], /replyText\s*=/, "abort path must NOT set a reply — interrupting is silent");
});
