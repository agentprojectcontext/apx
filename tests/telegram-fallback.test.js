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
  path.join(__dirname, "..", "src", "daemon", "plugins", "telegram.js"),
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

test("telegram: aborted requests still short-circuit silently", () => {
  // The abort path must remain a silent return — interrupting the user's own
  // request shouldn't generate a "could not reply" message.
  assert.match(
    SRC,
    /abortCtrl\.signal\.aborted[\s\S]{0,200}return;\s*\/\/ don't send reply if aborted/,
    "abort path must still return without replying",
  );
});
