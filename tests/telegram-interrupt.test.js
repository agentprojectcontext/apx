// Default Interrupt: a newer Telegram message must abort the in-flight turn.
//
// Two bugs made that a no-op in production:
//   1. The poll loop awaited the whole super-agent run, so getUpdates never
//      ran and the newer message sat in Telegram's queue until the zombie
//      finished — then every queued message ran sequentially.
//   2. The aborted turn did `activeRequests.delete(chat_id)` unconditionally,
//      which wiped the NEWER turn's AbortController, so the next interrupt
//      had nothing to abort.
//
// These tests pin the helpers + the poller stop path. The dispatch detach is
// pinned in telegram-fallback.test.js (source contract).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { releaseActiveRequest, isImpatientResend } from "#core/channels/telegram/helpers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN = fs.readFileSync(
  path.join(__dirname, "..", "src", "host", "daemon", "plugins", "telegram", "index.js"),
  "utf8",
);

test("releaseActiveRequest: only drops the controller we own", () => {
  const map = new Map();
  const oldCtrl = { id: "old" };
  const newCtrl = { id: "new" };
  map.set(42, newCtrl);

  releaseActiveRequest(map, 42, oldCtrl);
  assert.equal(map.get(42), newCtrl, "a finished/aborted turn must not wipe the newer controller");

  releaseActiveRequest(map, 42, newCtrl);
  assert.equal(map.has(42), false, "the owner of the current controller may drop it");
});

test("releaseActiveRequest: missing chat is a no-op", () => {
  const map = new Map();
  releaseActiveRequest(map, null, {});
  releaseActiveRequest(map, 99, {});
  assert.equal(map.size, 0);
});

// The other half of Default Interrupt: NOT interrupting. A long turn goes quiet
// (one progress note per 90s), the user assumes it died and resends — and the
// resend killed the work in flight, so the restarted turn looked stuck too. Six
// resends of one message in 35 minutes, nothing ever finished.
test("isImpatientResend: the same message again, mid-turn, is not a new instruction", () => {
  const t0 = 1_000_000;
  const prev = { text: "probemos la de ideas, a ver cómo va", startedAt: t0 };
  const now = () => t0 + 90_000;

  assert.equal(isImpatientResend(prev, "probemos la de ideas, a ver cómo va", { now }), true);
  // Typos, case and punctuation drift between resends; the intent does not.
  assert.equal(isImpatientResend(prev, "Probemos la de ideas... a ver como va!", { now }), true);
});

test("isImpatientResend: a genuinely new message still interrupts", () => {
  const t0 = 1_000_000;
  const prev = { text: "corré la rutina de ideas", startedAt: t0 };
  const now = () => t0 + 90_000;

  assert.equal(isImpatientResend(prev, "no, dejá eso y mirá el post", { now }), false);
  assert.equal(isImpatientResend(prev, "", { now }), false);
  assert.equal(isImpatientResend(null, "corré la rutina de ideas", { now }), false);
});

test("isImpatientResend: past the window, a repeat means 'that is stuck, start over'", () => {
  const t0 = 1_000_000;
  const prev = { text: "corré la rutina de ideas", startedAt: t0 };
  assert.equal(
    isImpatientResend(prev, "corré la rutina de ideas", { now: () => t0 + 11 * 60_000 }),
    false,
  );
});

test("telegram plugin stop() aborts every in-flight turn", () => {
  // `apx daemon restart` has to actually interrupt Telegram. Clearing the
  // polling flag alone left the super-agent running until it finished.
  const stop = PLUGIN.match(/stop\(\) \{[\s\S]{0,500}?\n  \}/);
  assert.ok(stop, "ChannelPoller.stop() must exist");
  assert.match(stop[0], /activeRequests/, "stop must walk in-flight requests");
  assert.match(stop[0], /\.abort\(\)/, "stop must abort each controller");
});
