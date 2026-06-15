// Regression test for the Telegram inbound handler. When the super-agent
// throws for any reason OTHER than an explicit abort, the bot used to drop
// the turn silently — looking like it ignored the user. Now it surfaces a
// short error reply via the same channel.
//
// We don't exercise the real plugin (needs a live Telegram channel + many
// stubs). We instead read the source and assert the surface-the-error code
// path is present near the super-agent catch block. This guards against a
// silent regression to the old "return without reply" behaviour.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(
  // _handleUpdate body lives in dispatch.js, now under core/channels/telegram/.
  path.join(__dirname, "..", "src", "core", "channels", "telegram", "dispatch.js"),
  "utf8",
);

test("telegram: super-agent catch surfaces a reply on non-abort errors", () => {
  // Locate the super-agent catch block. The contract:
  //   - if abortCtrl.signal.aborted → return (silent, expected)
  //   - otherwise → assign replyText so the user gets a notification
  const block = SRC.match(
    /super-agent failed: \$\{e\.message\}[\s\S]{0,500}/,
  );
  assert.ok(block, "super-agent failed log line must be present");
  // The catch block should assign replyText (not just log + return).
  assert.match(
    block[0],
    /replyText\s*=/,
    "non-abort errors must set replyText so the user sees the failure",
  );
  // And the assigned text should look user-facing (warning emoji or 'Could not').
  assert.match(
    block[0],
    /Could not generate a reply|⚠️/,
    "fallback reply should be a clear user-facing message",
  );
});

test("telegram: empty final text never ends the turn silently", () => {
  // The final-send floor must cover EVERY empty-final case, not just
  // streamedCount === 0. A turn that streamed prose / acted but produced no
  // closing (e.g. the loop hit its cap) must still send something — a neutral
  // "continue?" that does not claim completion.
  const floor = SRC.match(/}\s*else if \(!finalClean\) \{[\s\S]{0,1200}?\n {4}\}/);
  assert.ok(floor, "final-send must have an `else if (!finalClean)` floor branch");
  assert.match(
    floor[0],
    /telegram\.fallback_continue/,
    "a cut-off turn that streamed/acted gets the neutral continue prompt",
  );
  assert.match(
    floor[0],
    /telegram\.fallback_listo/,
    "a pure chit-chat turn (nothing streamed) still gets the short ack",
  );
});

test("telegram: aborted requests still short-circuit silently", () => {
  // The abort path must remain a silent return — interrupting the user's own
  // request shouldn't generate a "could not reply" message. We assert the
  // contract (the abort branch returns and never assigns replyText) rather
  // than an exact comment string, so wording changes don't break the test.
  const abortBlock = SRC.match(/if \(abortCtrl\.signal\.aborted\) \{[\s\S]{0,400}?\n {8}\}/);
  assert.ok(abortBlock, "abort branch must exist");
  assert.match(abortBlock[0], /return;/, "abort path must return");
  assert.doesNotMatch(
    abortBlock[0],
    /replyText\s*=/,
    "abort path must NOT set a reply — interrupting is silent",
  );
});
