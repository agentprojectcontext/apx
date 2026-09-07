// What an a2a thread shows while a peer is working, and what it shows about
// the work afterwards. Two silences, one thread.
//
// THE FAILURES THIS FIXES, both seen on 2026-09-07:
//
//   "¿está respondiendo magui en el fondo o se colgó?" — a delivered a2a turn
//   is a full tool loop that may run the whole 300 s budget, and nothing
//   registered it. `startActiveTurn` was called by groups, exec and the
//   super-agent, never by the peer-reply path, so `active_turn` was null for
//   every a2a row and the thread GET returned a hard `null` for the channel.
//   From the inbox a slow peer and a dead one looked exactly the same.
//
//   "tampoco veo tools, no sé si ejecuta" — d06ed30 moved the peer's tool trace
//   off the ledger into the reply's `meta.trace` (right call: those rows ate
//   84% of a peer's context on the next turn), but nothing read it back out.
//   The thread showed the claim and none of the work.
//
// The assertions are about the two seams that broke: the turn key both sides
// have to agree on, and the one function that turns a row into a message.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-a2avis-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx");

const { a2aThreadId, shapeLedgerMessage } = await import("#core/stores/messages.js");
const { startActiveTurn, endActiveTurn, getActiveTurnByKey, threadTurnKey } =
  await import("#host/daemon/active-turns.js");

test("the thread id is the pair, whichever way round it is sent", () => {
  assert.equal(a2aThreadId("claude", "magui"), "claude~magui");
  assert.equal(a2aThreadId("magui", "claude"), "claude~magui");
  assert.equal(a2aThreadId("claude", "super_agent"), "claude~super_agent");
  // An agent talking to itself is one participant, not a pair with a hole in it.
  assert.equal(a2aThreadId("roby", "roby"), "roby");
});

test("the key the peer registers is the key the inbox looks up", () => {
  // conversations.js writes this…
  const written = threadTurnKey(7, "a2a", a2aThreadId("claude", "magui"));
  const active = startActiveTurn(written, {
    project_id: 7, channel: "a2a", thread_id: a2aThreadId("claude", "magui"), agent_slug: "magui",
  });
  try {
    // …and inbox.js reads it from the row, which carries the id the other way round.
    const row = { kind: "a2a", project_id: 7, channel: "a2a", conversation_id: "claude~magui" };
    const found = getActiveTurnByKey(threadTurnKey(row.project_id, row.channel, row.conversation_id));
    assert.ok(found, "the inbox cannot see the turn the peer registered");
    assert.equal(found.turn_id, active.id, "a different turn than the one registered");
    assert.equal(found.thread_id, "claude~magui");
  } finally {
    endActiveTurn(active.id);
  }
  assert.equal(getActiveTurnByKey(written), null, "a finished turn must stop showing as live");
});

test("a peer's tool trace survives the trip from ledger row to message", () => {
  const row = {
    type: "agent",
    ts: "2026-09-07T17:38:10Z",
    author: "magui",
    agent_slug: "magui",
    body: "Leído y resuelto.",
    meta: {
      final: true,
      model: "zen:big-pickle",
      trace: [
        { tool: "run_shell", args: { cmd: "ls" }, result: "ok" },
        { tool: "list_tasks", args: {}, result: [] },
      ],
    },
  };
  const m = shapeLedgerMessage(row);
  assert.equal(m.role, "assistant");
  assert.equal(m.trace?.length, 2, "the trace never reached the thread viewer");
  assert.equal(m.trace[0].tool, "run_shell");
  assert.deepEqual(m.trace[0].args, { cmd: "ls" });
});

test("a turn that called nothing carries no trace — an empty list is not work", () => {
  const m = shapeLedgerMessage({
    type: "agent", ts: "2026-09-07T18:01:06Z", author: "magui", agent_slug: "magui",
    body: "Ahora lo apliqué de verdad, verifiqué cada línea.",
    meta: { final: true, trace: [] },
  });
  // The real 18:01 reply: it claimed the work and ran zero tools. The viewer
  // must not draw an action group for it — an empty group reads like work.
  assert.equal(m.trace, undefined);
});

test("a row with no trace at all is unchanged", () => {
  const m = shapeLedgerMessage({
    type: "agent", ts: "2026-09-07T18:00:06Z", author: "claude", agent_slug: "claude",
    body: "Dos cosas, Magui.", meta: { final: true },
  });
  assert.equal(m.trace, undefined);
  assert.equal(m.content, "Dos cosas, Magui.");
});
