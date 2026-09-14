// A turn that arrives on Telegram is a turn the WHOLE system can see.
//
// THE FAILURE, 2026-09-14. Manu, reading the same conversation twice at once:
// "en canal telegram cuando entro por web veo que está parado, pero si
// actualizo siguen apareciendo tools y me sigue respondiendo, y en telegram
// dice Escribiendo."
//
// Both halves of that are one missing piece. The ledger was never the problem —
// the tool rows were on disk as they happened, which is why a refresh showed
// them. What was missing is that NOTHING registered the turn: `startActiveTurn`
// had callers in api/super-agent.js, api/groups.js, api/code.js, api/exec.js
// and api/conversations.js, and no caller at all in any channel. So a turn was
// followable if an HTTP route happened to start it and invisible if a person
// wrote to the bot — and `sendChatAction` (Telegram's own "Escribiendo…")
// reaches exactly one place: that chat.
//
// The reader side already existed and already agreed on the key. That is what
// makes this a wiring bug and not a design one, and it is what the seam test
// below pins.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-tgturn-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx");

const { trackChannelTurn } = await import("#host/daemon/channel-turn.js");
const { getActiveTurnByKey, superAgentTurnKey, endActiveTurn } =
  await import("#host/daemon/active-turns.js");
const { eventsClients } = await import("#host/daemon/events-ws.js");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DISPATCH = fs.readFileSync(
  path.join(__dirname, "..", "src", "core", "channels", "telegram", "dispatch.js"),
  "utf8",
);
const PLUGIN = fs.readFileSync(
  path.join(__dirname, "..", "src", "host", "daemon", "plugins", "telegram", "index.js"),
  "utf8",
);

/** A connected surface, close enough for the hub: it only checks readyState
 *  and calls send(). Everything pushed to every client lands in `frames`. */
function watcher() {
  const frames = [];
  const ws = { readyState: 1, send: (raw) => frames.push(JSON.parse(raw)) };
  eventsClients.add(ws);
  return {
    frames,
    turns: () => frames.filter((f) => f.type === "turn"),
    stop: () => eventsClients.delete(ws),
  };
}

// ── The seam that broke ──────────────────────────────────────────────────────

test("the key Telegram registers is the key the thread GET looks up", () => {
  const day = "2026-09-14";
  // What the dispatcher now writes, through the plugin's `_trackTurn`…
  const turn = trackChannelTurn({
    key: superAgentTurnKey(3, "telegram"),
    projectId: 3,
    channel: "telegram",
    threadId: day,
  });
  try {
    // …and what GET /projects/:pid/super-agent/threads/:channel/:id reads for a
    // global channel thread: keyed by (project, channel), matched on thread_id.
    const found = getActiveTurnByKey(superAgentTurnKey(3, "telegram"));
    assert.ok(found, "the web cannot see the turn Telegram registered");
    assert.equal(found.turn_id, turn.id);
    assert.equal(found.thread_id, day, "a thread_id that does not match is dropped by the reader");
    assert.equal(found.channel, "telegram");
  } finally {
    turn.end();
  }
  assert.equal(
    getActiveTurnByKey(superAgentTurnKey(3, "telegram")), null,
    "a finished turn must stop showing as live — a registry leak is a spinner nobody can stop",
  );
});

// ── The narration ────────────────────────────────────────────────────────────

test("a tracked turn is announced before it has said anything", () => {
  const w = watcher();
  const turn = trackChannelTurn({
    key: superAgentTurnKey(1, "telegram"), projectId: 1, channel: "telegram", threadId: "2026-09-14",
  });
  try {
    // The frame that makes a thread say somebody is working. Without it the
    // bubble did not exist until the first tool landed, so a turn that thinks
    // for thirty seconds showed the question and silence under it.
    const [first] = w.turns();
    assert.equal(first?.phase, "start");
    assert.equal(first.channel, "telegram");
    assert.equal(first.thread_id, "2026-09-14");
    assert.equal(first.turn_id, turn.id);
  } finally {
    turn.end();
    w.stop();
  }
});

test("the tools a Telegram turn runs are recorded AND pushed", () => {
  const w = watcher();
  const turn = trackChannelTurn({
    key: superAgentTurnKey(1, "telegram"), projectId: 1, channel: "telegram", threadId: "2026-09-14",
  });
  try {
    turn.onEvent({ type: "tool_start", trace: { id: "1:1", tool: "run_shell", args: { command: "date" } } });
    turn.onEvent({ type: "tool_result", trace: { id: "1:1", tool: "run_shell", result: { exit_code: 0 } } });
    turn.onEvent({ type: "assistant_text", text: "listo" });

    // RECORDED: what somebody who opens the thread mid-turn catches up from.
    // Text alone is not enough — it makes a working turn look idle, which is
    // the picture Manu was reading.
    const live = getActiveTurnByKey(superAgentTurnKey(1, "telegram"));
    const tool = live.parts.find((p) => p.kind === "tool");
    assert.equal(tool?.tool, "run_shell");
    assert.equal(tool.status, "done");
    assert.equal(live.text, "listo");

    // PUSHED: what somebody already watching sees without refreshing. The two
    // have to stay in step; when the record kept the tools and the feed carried
    // only text, a follower watched a multi-step turn collapse into a paragraph.
    const pushed = w.turns().filter((f) => f.phase === "event").map((f) => f.event.type);
    assert.deepEqual(pushed, ["tool_start", "tool_result", "assistant_text"]);
  } finally {
    turn.end();
    w.stop();
  }
});

test("every ending closes the follower's bubble, and each says which ending it was", () => {
  for (const [name, close] of [
    ["final", (t) => t.final({ text: "listo", model: "zen:big-pickle" })],
    ["error", (t) => t.error("boom")],
    ["aborted", (t) => t.aborted("lo que alcanzó a decir")],
  ]) {
    const w = watcher();
    const turn = trackChannelTurn({
      key: superAgentTurnKey(9, "telegram"), projectId: 9, channel: "telegram", threadId: "2026-09-14",
    });
    close(turn);
    turn.end();
    // Without a closing frame the bubble stays pending forever, the silent
    // catch-up refuses to run (it skips while a turn is in flight) and Stop
    // sits on screen over a turn that ended minutes ago.
    assert.equal(w.turns().at(-1)?.phase, name, `a ${name} ending never reached the follower`);
    w.stop();
  }
});

test("a superseded turn is reported as stopped, carrying what it managed to say", () => {
  const w = watcher();
  const turn = trackChannelTurn({
    key: superAgentTurnKey(9, "telegram"), projectId: 9, channel: "telegram", threadId: "2026-09-14",
  });
  turn.onEvent({ type: "assistant_text", text: "iba por acá" });
  // Default Interrupt: a newer Telegram message aborts this one. "Stopped" and
  // "broke" are not the same picture, and the half-written answer is only in
  // the registry — the abort path files no text of its own.
  turn.aborted();
  turn.end();
  const last = w.turns().at(-1);
  assert.equal(last.phase, "aborted");
  assert.equal(last.result.text, "iba por acá");
  w.stop();
});

test("tracking never takes the reply down with it", () => {
  // Being watched is not worth failing an answer for. A key that cannot be
  // registered must cost the panel its spinner, never the owner their reply.
  const turn = trackChannelTurn({ key: superAgentTurnKey(1, "telegram"), channel: "telegram" });
  assert.doesNotThrow(() => turn.onEvent(null));
  assert.doesNotThrow(() => turn.onEvent({ type: "nonsense" }));
  assert.doesNotThrow(() => turn.end());
  assert.doesNotThrow(() => turn.end(), "ending twice is what a finally plus an error path both do");
  endActiveTurn(turn.id);
});

// ── The wiring ───────────────────────────────────────────────────────────────
// Driving the real dispatcher needs a live channel and a dozen stubs, so the
// wiring is read from the source — the same contract style the rest of this
// channel's tests use (telegram-fallback.test.js).

test("the dispatcher registers the turn, and deregisters it whatever happens", () => {
  assert.match(DISPATCH, /self\._trackTurn\?\.\(/, "the inbound turn must be registered");
  assert.match(
    DISPATCH,
    /threadId: new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/,
    "a global channel thread is addressed by its day — the reader matches on it",
  );
  // Three paths return early (aborted mid-run, aborted after the branch, the
  // ask-flow hand-off). A turn left in the registry is a spinner that never
  // stops on every panel in the house, so the deregistration belongs in a
  // finally and nowhere else.
  assert.match(DISPATCH, /\} finally \{\n\s*\/\/[\s\S]{0,400}?turn\?\.end\(\);/, "turn?.end() must be in a finally");
  assert.match(DISPATCH, /turn\?\.final\(\{/, "an answered turn must close the follower's bubble");
  assert.match(DISPATCH, /turn\?\.aborted\(\)/, "a superseded turn must say it was stopped, not just vanish");
});

test("both audiences are served from the same events, and neither owns the other", () => {
  // The stream handler decides what TELEGRAM sees (prose only, intermediate
  // notes held). The tracker records the same steps for every other surface,
  // which wants the opposite: the tools, as they happen. If the chain is ever
  // dropped, the web goes dark again and Telegram looks perfectly fine — which
  // is exactly how this shipped.
  const chain = DISPATCH.match(/const onEvent = async \(ev\) => \{[\s\S]{0,200}?\};/);
  assert.ok(chain, "the two renderings must hang off one event stream");
  assert.match(chain[0], /turn\?\.onEvent\(ev\)/);
  assert.match(chain[0], /streamToChat\(ev\)/);
});

test("core reaches the daemon registry through the plugin, not by importing upward", () => {
  // Rule 8. The registry and the WS hub are daemon runtime; core must not
  // import `#host/*`. The hook arrives on `self`, exactly like `_send`.
  assert.doesNotMatch(DISPATCH, /#host\//, "core/channels must never import daemon runtime");
  assert.match(PLUGIN, /_trackTurn\(opts = \{\}\)/, "the plugin owns the hook");
  assert.match(PLUGIN, /superAgentTurnKey\(/, "and builds the key the reader uses");
  assert.match(PLUGIN, /trackChannelTurn\(/, "through the one shared tracker, not a private copy");
});
