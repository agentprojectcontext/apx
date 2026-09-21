// A coding session drawn as the panel's own chat — the three voices, and the
// turn that has been sent and not yet answered.
//
// The room used to hand-roll its bubbles and its textarea, and every difference
// from the real chat was a bug: the draft stayed in the box after sending ("no
// sale el mensaje"), and nothing on screen said a run was in flight ("no veo si
// está contestando") for the minutes one takes. It renders through MessageList
// and Composer now, so what is left to get wrong is the mapping — which ledger
// row becomes whose turn, and when the locally-held one is let go.
//
// Imports the web's TypeScript directly (Node strips types natively), the same
// way runtime-row-routing.test.js does for logic with no DOM in it.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { toChatMsgs, countSaying, isAnswering, STILL_ANSWERING_MS } = await import(
  path.join(ROOT, "src/interfaces/web/src/lib/runtime-room.ts")
);

/** "Now" for the tests: the transcript below ends at 10:09 on 2026-09-20. */
const T = (hhmm) => Date.parse(`2026-09-20T${hhmm}:00Z`);

const ENGINE = "claude-code";

// One session as the room shapes it: the owner asked, an agent asked in his
// name, and the engine answered both times.
const LINES = [
  { role: "user", content: "arreglá el build", ts: "2026-09-20T10:00:00Z" },
  { role: "assistant", content: "listo", ts: "2026-09-20T10:04:00Z", agent: "claude-code", actor_kind: "engine" },
  {
    role: "assistant", content: "ahora corré los tests", ts: "2026-09-20T10:05:00Z",
    agent: "apx", agent_name: "APX", actor_kind: "agent", on_behalf_of: "owner",
  },
  { role: "assistant", content: "3184 pasando", ts: "2026-09-20T10:09:00Z", agent: "claude-code", actor_kind: "engine" },
];

test("the owner's prompt is the owner's turn, and nobody else's is", () => {
  const msgs = toChatMsgs(LINES, ENGINE);
  assert.equal(msgs.length, 4);
  // His own words, on his own side of the thread.
  assert.equal(msgs[0].role, "user");
  assert.equal(msgs[0].parts[0].text, "arreglá el build");
  assert.equal(msgs[0].onBehalfOf, undefined);
  // The engine answering: named, and wearing its own id so the face resolver
  // reaches its brand mark.
  assert.equal(msgs[1].role, "assistant");
  assert.equal(msgs[1].agent, "claude-code");
  assert.equal(msgs[1].agentId, "claude-code");
});

test("an agent's prompt speaks as the agent, and says it went out as the owner", () => {
  // The whole reason the room exists. `claude -p` has exactly one user and does
  // not care who typed the words, so from the engine's side these two prompts
  // were identical — and a thread that drew them identically would be putting
  // words in Manu's mouth. "El agente habla como agente pero claude recibe como
  // yo mismo, y yo veo los 3 tipos" (2026-09-20).
  const agentTurn = toChatMsgs(LINES, ENGINE)[2];
  assert.equal(agentTurn.role, "assistant");
  assert.equal(agentTurn.agent, "APX");
  assert.equal(agentTurn.onBehalfOf, "owner");
  // And it is NOT filed as the owner's: that is the lie this prevents.
  assert.notEqual(agentTurn.role, "user");
});

test("tool and system rows are not turns", () => {
  const msgs = toChatMsgs([
    ...LINES,
    { role: "tool", content: "bash: npm test" },
    { role: "system", content: "resumed" },
  ], ENGINE);
  assert.equal(msgs.length, 4);
});

test("a sent turn is on screen before the poll brings it back, with the engine still thinking", () => {
  // The gap this closes: the composer clears on send, the room is polled, and
  // for as long as the run takes there was NOTHING — which reads as a message
  // that failed to send.
  const msgs = toChatMsgs(LINES, ENGINE, { text: "y el lint?", ts: "2026-09-20T10:10:00Z" }, T("10:10"));
  assert.equal(msgs.length, 6);
  assert.equal(msgs[4].role, "user");
  assert.equal(msgs[4].parts[0].text, "y el lint?");
  // The pending half is what draws "está contestando": an engine turn with no
  // parts yet, which is exactly the shape a live agent turn has.
  assert.equal(msgs[5].role, "assistant");
  assert.equal(msgs[5].pending, true);
  assert.equal(msgs[5].agent, ENGINE);
  assert.deepEqual(msgs[5].parts, []);
});

test("the waiting bubble is the ROOM's answer, not this tab's", () => {
  // The bug this exists for: the prompt reaches the ledger IMMEDIATELY —
  // `appendRuntimePrompt` runs before the engine is even spawned — so an
  // indicator hung off the locally-held turn switched off on the next poll,
  // four seconds into a run that takes minutes. "No veo si está contestando"
  // (Manu, 2026-09-20), and that is the half of it a local flag cannot fix.
  const asked = [...LINES, { role: "user", content: "y el lint?", ts: "2026-09-20T10:10:00Z" }];
  assert.equal(isAnswering(asked, T("10:12")), true, "a prompt with nothing under it is being worked on");

  // And it survives the local turn being let go: no `pending`, still waiting.
  const msgs = toChatMsgs(asked, ENGINE, null, T("10:12"));
  assert.equal(msgs[msgs.length - 1].pending, true);
  assert.equal(msgs.filter((m) => m.pending).length, 1, "one waiting bubble, never two");
});

test("a session somebody else launched shows as working too", () => {
  // The room is the source, so a session Roby opened a minute ago reads as
  // live on a screen that never sent anything — and survives a refresh, which
  // a flag in a component cannot.
  const theirs = [{
    role: "assistant", content: "arreglá el build", ts: "2026-09-20T10:10:00Z",
    agent: "apx", agent_name: "APX", actor_kind: "agent", on_behalf_of: "owner",
  }];
  assert.equal(isAnswering(theirs, T("10:11")), true);
});

test("an answered room is not waiting on anything", () => {
  assert.equal(isAnswering(LINES, T("10:10")), false, "the engine spoke last");
  assert.equal(toChatMsgs(LINES, ENGINE, null, T("10:10")).some((m) => m.pending), false);
  assert.equal(isAnswering([], T("10:10")), false, "an empty room waits on nobody");
});

test("a prompt older than the deadline stops spinning", () => {
  // The other direction, and the one a naive "last row is a prompt" gets
  // wrong: a run that died without writing its answer, or a room from May
  // opened out of the archive, would show a spinner for ever. A spinner is a
  // promise that something will move.
  const asked = [...LINES, { role: "user", content: "y el lint?", ts: "2026-09-20T10:10:00Z" }];
  const wayLater = T("10:10") + STILL_ANSWERING_MS + 1000;
  assert.equal(isAnswering(asked, wayLater), false);
  assert.equal(toChatMsgs(asked, ENGINE, null, wayLater).some((m) => m.pending), false);
  // A row with no timestamp at all cannot be argued to be recent.
  assert.equal(isAnswering([{ role: "user", content: "?" }], T("10:10")), false);
});

test("the locally-held turn is let go once the ledger has it — by count, not by presence", () => {
  // Asking the same thing twice is ordinary ("dale", "seguí"). Matching on
  // presence would find the first copy already in the thread and drop the
  // second one off the screen the instant it was sent, which is the same
  // disappearing message in a new disguise.
  const said = [...LINES, { role: "user", content: "dale", ts: "2026-09-20T10:11:00Z" }];
  assert.equal(countSaying(said, "dale"), 1);
  // Sent a second time: one copy on the ledger, so the local one still stands.
  assert.ok(countSaying(said, "dale") <= 1, "not landed yet while the count has not moved");
  // The poll returns with it: the count passes what was there at send time.
  const after = [...said, { role: "user", content: "dale", ts: "2026-09-20T10:12:00Z" }];
  assert.ok(countSaying(after, "dale") > 1, "landed");
  // Whitespace the composer trimmed must not keep a turn on screen for ever.
  assert.equal(countSaying([{ role: "user", content: "  dale  " }], "dale"), 1);
});
