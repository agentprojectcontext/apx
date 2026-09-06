import { test } from "node:test";
import assert from "node:assert/strict";
import { dedupA2A } from "#core/stores/messages.js";

function row({ ts, ledger, author = "builder", body = "listo", external_id = null }) {
  return {
    ts,
    channel: "a2a",
    author,
    body,
    agent_slug: ledger,
    external_id,
    meta: ledger === author ? { to: "reviewer" } : { from: author },
  };
}

test("A2A dedup uses logical id even when mirror timestamps cross a second", () => {
  const rows = [
    row({ ts: "2026-09-06T10:00:00Z", ledger: "builder", external_id: "a2a_1" }),
    row({ ts: "2026-09-06T10:00:02Z", ledger: "reviewer", external_id: "a2a_1" }),
  ];
  const out = dedupA2A(rows);
  assert.equal(out.length, 1);
  assert.equal(out[0].agent_slug, "builder", "speaker copy keeps attribution");
});

test("legacy A2A mirrors collapse, but genuine repeated messages do not", () => {
  const rows = [
    row({ ts: "2026-09-06T10:00:00Z", ledger: "builder" }),
    row({ ts: "2026-09-06T10:00:02Z", ledger: "reviewer" }),
    row({ ts: "2026-09-06T10:00:03Z", ledger: "builder" }),
  ];
  assert.equal(dedupA2A(rows).length, 2);
});

test("different messages with the same long prefix remain separate", () => {
  const prefix = "x".repeat(140);
  const rows = [
    row({ ts: "2026-09-06T10:00:00Z", ledger: "builder", body: `${prefix} A` }),
    row({ ts: "2026-09-06T10:00:00Z", ledger: "builder", body: `${prefix} B` }),
  ];
  assert.equal(dedupA2A(rows).length, 2);
});
