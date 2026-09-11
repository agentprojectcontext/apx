// Two things a chat pane must survive: losing the socket that started a turn,
// and losing the page.
//
// 1. FOLLOWING a turn. The daemon pushes every turn in flight over the shared
//    feed, and a pane that did not start it repainted the bubble from the
//    accumulated TEXT — so closing the tab, refreshing or walking to another
//    chat and back turned a nine-step turn into one growing paragraph with
//    every tool erased, and the closing frame flattened whatever had survived.
//    A followed turn now goes through applyStreamEvent, the same reducer the
//    sending pane uses, so both read identically.
//
// 2. QUEUEING a turn. A queued message lived in a module-level Map, so a reload
//    threw away a line already accepted from the composer with nothing to say
//    it had existed — and the drain fired the moment a pane BOUND the queue,
//    which happens one fetch BEFORE that pane knows which conversation it is
//    on. The parked line therefore went out with no conversation id and the
//    daemon opened a second one beside the turn still being written: one queued
//    message, two sessions, neither of them the chat it was written in.
//
// Source contracts, like the rest of the web tests: useChat.ts cannot be
// imported here (React, and vite-style extensionless imports), and these are
// exactly the paths that regress silently — nothing throws, the chat just
// quietly forgets.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const web = (...p) => fs.readFileSync(path.join(__dirname, "..", "src", "interfaces", "web", "src", ...p), "utf8");

test("a followed turn is rendered by the same reducer as one this tab sent", () => {
  const hook = web("hooks", "useChat.ts");
  const follow = hook.slice(hook.indexOf("const onTurnFrame"), hook.indexOf("useEffect(() => subscribeTurns"));

  // Tokens and steps both arrive as frames, and both go through the reducer.
  assert.match(follow, /f\.phase === "event"/, "the feed carries the tools, not only the tokens");
  assert.match(follow, /patchLive\(f\.turn_id, f\.event, slug\)/);
  assert.match(follow, /type: "assistant_delta", delta: f\.delta/);

  const patch = hook.slice(hook.indexOf("const patchLive"), hook.indexOf("const closeLive"));
  assert.match(patch, /applyStreamEvent\(/, "the followed bubble is built by the shared reducer");
  assert.doesNotMatch(
    patch,
    /parts: \[\{ kind: "text"/,
    "repainting the bubble from accumulated text is what erased the tools",
  );

  // Closing a followed turn must not flatten it either: `final` used to replace
  // every part with one text blob, which threw the work away at the last step.
  const close = hook.slice(hook.indexOf("const closeLive"), hook.indexOf("const onTurnFrame"));
  assert.match(close, /fn\(base\)/, "how it ends is decided from the turn as it stands");
  assert.doesNotMatch(close, /parts: \[\{ kind: "text"/);
  assert.match(follow, /\.\.\.m,\s*\n\s*parts: \[\.\.\.m\.parts/, "an error keeps the steps that did run");

  // The partial a mid-turn reload hydrates is what the next frame builds ON.
  assert.match(hook, /liveTurnRef = useRef<\{ id: string; msg: ChatMsg \} \| null>/);
  assert.match(hook, /liveTurnRef\.current = \{ id: active\.turn_id, msg: activeTurnMsg\(active\)! \}/);
});

test("the daemon records and pushes the same timeline on every chat route", () => {
  // One predicate, so the client that RE-OPENS a turn and the one that FOLLOWS
  // it are never shown different work.
  //
  // `conversations.js` is the a2a route, and it was the one left out. It pushed
  // `event` and nothing else, which is half a turn: no `start`, so the thread
  // stayed blank until the first tool landed and a peer that thinks before it
  // acts was indistinguishable from a dead one; no `final`, so the follower's
  // bubble never closed — it stayed pending, the silent catch-up refused to run
  // behind it, and Stop sat over a turn that had ended minutes before.
  for (const route of ["exec.js", "super-agent.js", "code.js", "conversations.js"]) {
    const src = fs.readFileSync(
      path.join(__dirname, "..", "src", "host", "daemon", "api", route),
      "utf8",
    );
    assert.match(src, /recordActiveTurnEvent\(active\.id, ev(ent)?\)/, `${route} must record the timeline`);
    assert.match(src, /isVisibleTurnEvent\(ev(ent)?\)\) turnFrame\("event"/, `${route} must push it too`);
    // A turn is a story: it has to say when it starts and how it ends, or the
    // surfaces following it cannot draw either edge.
    assert.match(src, /turnFrame\("start"\)/, `${route} must announce the turn before any output`);
    assert.match(src, /turnFrame\("final"/, `${route} must close the turn it opened`);
    assert.match(src, /turnFrame\("error"/, `${route} must close a turn that broke`);
  }
});

test("a queued turn survives the page, and only ever goes out into its own chat", () => {
  const hook = web("hooks", "useChat.ts");

  // Survives a reload: parked turns are per-device state, like the unread marks.
  assert.match(hook, /const QUEUE_STORAGE_KEY = "apx\.chat\.queue\.v1"/);
  assert.match(hook, /localStorage\.setItem\(QUEUE_STORAGE_KEY/);
  assert.match(hook, /hydrateBackgroundQueues\(\);\s*\n\s*if \(queue\.length\)/, "every write persists");
  // Persistence must not hand the same line to two windows and send it twice.
  assert.match(hook, /addEventListener\("storage"/);
  // And a line parked for a day is forgotten rather than fired at whoever opens
  // the chat next.
  assert.match(hook, /QUEUE_TTL_MS/);

  const drain = hook.slice(hook.indexOf("const drainQueue"), hook.indexOf("drainQueueRef.current = drainQueue"));
  assert.match(drain, /streamingRef\.current \|\| followingRef\.current/, "never on top of a running turn");
  assert.match(drain, /if \(!queueReadyRef\.current\) return;/, "queued here means sent here");

  // A chat is bound in two beats and only the second one can send: the key when
  // it is picked, the conversation it names one fetch later.
  assert.match(hook, /bindQueue = useCallback\(\(key: string, ready = true\)/);
  assert.match(hook, /bindQueue\(activityKey, false\)/, "opening a stored chat binds PENDING");
  assert.match(hook, /bindQueue\(threadActivityKey\(pid, channel, threadId\), false\)/);
  assert.equal(
    (hook.match(/queueReadyRef\.current = true/g) || []).length,
    2,
    "both async opens settle the binding when their history lands",
  );
  // A live session has nothing to fetch, so it is open from the start — gating
  // it on a conversation it does not have yet would park its queue forever.
  const clearFn = hook.slice(hook.indexOf("const clear = useCallback"), hook.indexOf("const load = useCallback"));
  assert.match(clearFn, /bindQueue\(queueKey\)/);
  assert.doesNotMatch(clearFn, /bindQueue\(queueKey, false\)/);
});
