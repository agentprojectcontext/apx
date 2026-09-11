// Every phase the daemon broadcasts has to mean something to the panel.
//
// THE BUG THIS EXISTS FOR. `lib/chat-activity.ts` is the device-wide registry
// every chat rail reads: is this conversation working, does it have an unread
// answer. It classified a turn frame as "in flight" when the phase was `start`
// or `delta`, and treated EVERYTHING ELSE as the turn ending.
//
// On 2026-09-11 the daemon started broadcasting a fourth phase, `event` — a tool
// starting, a tool landing, a closed text segment — so that a tab which did not
// send the turn could watch its steps instead of a paragraph growing. Three
// routes were taught to push it and `useChat.ts` was taught to read it.
// chat-activity.ts was not, and its else-branch turned every one of those steps
// into "the turn finished":
//
//   · the spinner on the row died at the first tool
//   · the turn id went into `closedTurnIds`, so `isChatTurnClosed` told
//     `load()`/`loadThread()` to discard the daemon's live `active_turn` —
//     opening the chat mid-turn showed a working agent as an idle one
//   · a queued message drained on top of the turn still being written, because
//     the pane came back believing nothing was running
//
// An a2a thread emits `event` and nothing else, so there the agent's whole turn
// was invisible: the message that asked, and silence.
//
// Nothing threw. The suite stayed green because the web chat tests are source
// contracts over `useChat.ts`, and this file is not that one. So the contract
// here is deliberately the one that generalises: not "event is in flight" (that
// pins today's bug and no other) but "the panel classifies EVERY phase the
// daemon can send". The next phase added to a route fails this test until
// somebody decides, in chat-activity.ts, whether it ends a turn.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");

/** Every `turnFrame("x")` / `broadcastTurn({ phase: "x" })` in the daemon. */
function phasesTheDaemonSends() {
  const dir = path.join(ROOT, "src/host/daemon/api");
  const found = new Set();
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".js")) continue;
    const src = fs.readFileSync(path.join(dir, name), "utf8");
    for (const m of src.matchAll(/turnFrame\(\s*"([a-z_]+)"/g)) found.add(m[1]);
    for (const m of src.matchAll(/phase:\s*"([a-z_]+)"/g)) found.add(m[1]);
  }
  return found;
}

/** The two lists chat-activity.ts decides by: in-flight, and the terminal ones
 *  that also raise an unread mark. */
function phasesThePanelKnows() {
  const src = read("src/interfaces/web/src/lib/chat-activity.ts");
  const inFlight = src.match(/const IN_FLIGHT_PHASES = new Set\(\[([^\]]*)\]\)/);
  assert.ok(inFlight, "chat-activity.ts must name its in-flight phases in one place");
  const live = [...inFlight[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  // The terminal half is the branch after it: the phases that mark unread.
  const unread = [...src.matchAll(/frame\.phase === "([a-z_]+)"/g)].map((m) => m[1]);
  return { live, unread };
}

test("the panel classifies every turn phase the daemon broadcasts", () => {
  const sent = phasesTheDaemonSends();
  const { live, unread } = phasesThePanelKnows();
  // "error" ends a turn without an unread mark (nothing was said to read), so
  // it is legitimately in neither list — it falls to the terminal default.
  const classified = new Set([...live, ...unread, "error"]);
  const unknown = [...sent].filter((p) => !classified.has(p));
  assert.deepEqual(
    unknown,
    [],
    `the daemon sends ${JSON.stringify(unknown)} and chat-activity.ts decides nothing about it — ` +
      "it would fall through to the terminal branch and mark a working turn finished",
  );
});

test("a step inside a turn does not end it", () => {
  const { live } = phasesThePanelKnows();
  // The specific regression, kept as its own line so the failure names it.
  assert.ok(
    live.includes("event"),
    "`event` is a tool starting or landing — a step, not an ending",
  );
  assert.ok(live.includes("start") && live.includes("delta"));
});

test("a2a carries a whole turn, and its steps arrive as `event`", () => {
  // Why this route in particular: it emits no `delta` at all. An a2a reply is
  // recorded as complete text segments plus tool calls, never token by token,
  // so `event` is the ONLY thing between its start and its end. That is what
  // makes "anything that is not start/delta is over" fatal here rather than
  // merely wrong — a peer's entire turn is made of the phase that was being
  // read as an ending.
  const src = read("src/host/daemon/api/conversations.js");
  assert.match(src, /isVisibleTurnEvent\(ev\)\) turnFrame\("event"/, "a2a pushes its steps");
  assert.match(src, /turnFrame\("start"\)/, "…and says when the turn began");
  assert.match(src, /turnFrame\("final"/, "…and closes the bubble it opened");
});

test("the closed-turn set cannot grow without bound", () => {
  const src = read("src/interfaces/web/src/lib/chat-activity.ts");
  assert.match(src, /MAX_CLOSED_IDS/, "a tab open all day would otherwise leak one id per turn");
  assert.match(src, /function rememberClosed/);
});
