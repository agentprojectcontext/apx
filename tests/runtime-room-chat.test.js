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
const { toChatMsgs, countSaying } = await import(
  path.join(ROOT, "src/interfaces/web/src/lib/runtime-room.ts")
);

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
  const msgs = toChatMsgs(LINES, ENGINE, { text: "y el lint?", ts: "2026-09-20T10:10:00Z" });
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
