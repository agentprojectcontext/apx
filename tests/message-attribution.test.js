// The rule: an agent/assistant message written to the ledger or a conversation
// file MUST carry its attribution — the model that answered and the turn's token
// usage — in `meta`. The reader (shapeLedgerMessage) pulls `meta.model` and
// `meta.usage` straight out; a writer that omits them files a row that reopens
// as "0 tok", no model. That is the exact regression the routine turn-record fix
// closed once, and it kept reappearing on new insertion paths (a2a send, the
// super-agent's own web delivery, the /exec ledger row) because nothing stopped
// a new writer from forgetting.
//
// This is that stop. It scans every `type: "agent"` insertion in src/ and
// requires each to either carry attribution (a `model` and `usage` in the meta
// it builds, or a shared attribution helper) OR mark itself exempt with a
// `attribution-exempt:` comment stating why (a relay primitive, an external
// runtime's stdout, a mid-stream segment whose usage is only known at turn end).
// A NEW agent-message writer that does neither fails here — it has to make the
// choice on purpose.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(import.meta.dirname, "..");
const SRC = path.join(ROOT, "src");

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === "dist") continue;
      yield* walk(full);
    } else if (e.name.endsWith(".js")) {
      yield full;
    }
  }
}

// An insertion is attributed when its neighbourhood carries the model AND usage
// it spent, a shared attribution carrier (`...attribution`, `assistantMeta`), or
// an explicit exemption. The window reaches forward far enough to cover the meta
// block the `type: "agent"` line opens.
function isAccounted(lines, i) {
  const win = lines.slice(Math.max(0, i - 3), i + 20).join("\n");
  if (/attribution-exempt:/.test(win)) return true;         // opted out, on purpose
  if (/\battribution\b|assistantMeta/.test(win)) return true; // shared carrier
  return /\bmodel\b/i.test(win) && /\busage\b/i.test(win);    // stamps both itself
}

test("every agent-message insertion carries attribution or marks itself exempt", () => {
  const offenders = [];
  for (const file of walk(SRC)) {
    const lines = fs.readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      // The object-literal key `type: "agent"` — how a row is written, not a
      // `=== "agent"` comparison or a `meta.type` read.
      if (!/(^|[{,]\s*)type:\s*["']agent["']/.test(line)) return;
      if (!isAccounted(lines, i)) {
        offenders.push(`${path.relative(ROOT, file)}:${i + 1}`);
      }
    });
  }
  assert.deepEqual(
    offenders.sort(),
    [],
    `these write an agent message without model+usage and without an ` +
      `attribution-exempt: note:\n  ${offenders.join("\n  ")}`,
  );
});
