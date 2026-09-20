// An a2a turn a TOOL started is watched exactly like one an HTTP route started.
//
// THE SILENCE THIS CLOSES. `POST /projects/:pid/send` wraps the peer's run in
// `trackChannelTurn`: the thread says somebody is working before the first
// token, the tools show up as they run, and Stop has a hook to pull. The TOOL
// path — `send_to_agent`, `call_agent`, and every background job and wake-up
// built on them — did none of it. `messagePeer` was called with no `onEvent`
// and nothing registered the run, so the peer worked in total silence and the
// thread only moved once the reply was filed, minutes later.
//
// Manu, 2026-09-20: "en los últimos agent to agent, si lo mirás, la gente no
// respondió. Hay un problema ahí. Debería responder y debería verse que está
// respondiendo". They did respond. Nothing said so while it happened — and the
// only way to see the work at all was to press Stop, because the tool trace is
// filed on the reply and a stopped turn is the one that files early.
//
// It was load-bearing beyond the pane, too: `POST /jobs/:id/cancel` stops a
// background job by aborting the a2a turn registered under its thread, and no
// tool-path job ever registered one — so cancelling closed the record while the
// peer kept working, the one thing that route promises it does not do.
//
// Core cannot register anything (rule 8: the live-turn registry and the WS hub
// are daemon runtime), so it narrates on the bus and the daemon re-tells it
// through the very same `trackChannelTurn`. Both halves are pinned here.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-a2a-turnvis-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx");

const { test } = await import("node:test");
const { default: assert } = await import("node:assert/strict");
const { messagePeer } = await import("#core/agent/a2a/delegate.js");
const { appendMessageToFs, a2aThreadId } = await import("#core/stores/messages.js");
const { onPeerTurnEvent } = await import("#core/events/bus.js");
const { startEventsBridge } = await import("#host/daemon/events-ws.js");
const { getActiveTurnByKey, threadTurnKey, abortActiveTurn, listActiveTurns } =
  await import("#host/daemon/active-turns.js");
const { makeTempProject, cleanupTempProject } = await import("./_helpers.js");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");

function project() {
  const root = makeTempProject({ name: "northwind", agents: [{ slug: "ansel" }, { slug: "jaro" }] });
  const storagePath = path.join(TMP_HOME, "storage", path.basename(root));
  fs.mkdirSync(storagePath, { recursive: true });
  return {
    id: 7, path: root, storagePath, name: "northwind", config: {},
    logMessage: (payload) => appendMessageToFs({ projectRoot: storagePath, ...payload }),
  };
}

/** Collect the narration of whatever runs inside. */
async function narrationOf(run) {
  const seen = [];
  const off = onPeerTurnEvent((e) => seen.push(e));
  try { return { out: await run(), seen }; }
  finally { off(); }
}

test("a peer reached through a tool announces itself before it answers", async () => {
  const p = project();
  const { seen } = await narrationOf(() => messagePeer({
    project: p, to: "jaro", from: "ansel", body: "¿Tenés el brief?", config: {},
    replyFn: async ({ onEvent }) => {
      // A peer that spends a minute in tools before writing a word is
      // indistinguishable from a dead one unless this reaches a surface.
      await onEvent({ type: "tool_start", trace: { id: "t1", tool: "read_file" } });
      await onEvent({ type: "tool_result", trace: { id: "t1", tool: "read_file", result: "ok" } });
      return { text: "Sí, va.", model: "test:model" };
    },
  }));

  const start = seen.find((e) => e.phase === "start");
  assert.ok(start, "the turn has to be announced before a single token exists");
  assert.equal(start.channel, "a2a");
  assert.equal(start.thread_id, a2aThreadId("ansel", "jaro"), "keyed to the thread the inbox shows");
  assert.equal(start.project_id, 7);
  assert.equal(start.agent_slug, "jaro", "who is answering");
  assert.equal(typeof start.abort, "function", "…and what Stop pulls");

  const steps = seen.filter((e) => e.phase === "event").map((e) => e.event.type);
  assert.deepEqual(steps, ["tool_start", "tool_result"], "the work, not only the words");

  const final = seen.find((e) => e.phase === "final");
  assert.ok(final, "a follower's bubble needs a closing frame or it stays pending forever");
  assert.equal(final.result.text, "Sí, va.");
  assert.equal(final.result.model, "test:model");
  assert.ok(seen.some((e) => e.phase === "end"), "and the record has to be released");
  // One story, one id: every phase names the turn it belongs to.
  assert.equal(new Set(seen.map((e) => e.ref)).size, 1);
  cleanupTempProject(p.path);
});

test("a peer that never answers closes its turn too, as an error", async () => {
  const p = project();
  const { seen } = await narrationOf(async () => {
    await assert.rejects(
      messagePeer({
        project: p, to: "jaro", from: "ansel", body: "dale", config: {},
        replyFn: async () => { throw new Error("engine down"); },
      }),
      /engine down/,
    );
  });
  const err = seen.find((e) => e.phase === "error");
  assert.ok(err, "a turn that broke must say so rather than be left open");
  assert.match(err.error, /engine down/);
  assert.ok(seen.some((e) => e.phase === "end"));
  cleanupTempProject(p.path);
});

test("stopping the registered turn stops the work", async () => {
  const p = project();
  let sawAbort = false;
  let pull = null;   // the hook the start frame handed the daemon
  const { seen } = await narrationOf(async () => {
    const off = onPeerTurnEvent((e) => { if (e.phase === "start") pull = e.abort; });
    try {
      await assert.rejects(
        messagePeer({
          project: p, to: "jaro", from: "ansel", body: "algo largo", config: {},
          replyFn: async ({ signal }) => {
            // What the daemon's Stop — and POST /jobs/:id/cancel — reach.
            pull();
            sawAbort = signal.aborted;
            throw new Error("aborted");
          },
        }),
        /aborted/,
      );
    } finally { off(); }
  });
  assert.ok(sawAbort, "the peer has to receive the signal the abort hook pulls");
  assert.ok(seen.some((e) => e.phase === "aborted"), "stopped is not broken — it is its own ending");
  assert.ok(!seen.some((e) => e.phase === "error"), "and must not be reported as a failure");
  cleanupTempProject(p.path);
});

test("through the daemon bridge the pair really is a live turn, and Stop reaches it", async () => {
  // End to end across the seam: core emits, the bridge registers, and the
  // record that appears is the one the inbox reads and `POST /turns/abort`
  // pulls. Regexes below pin the shape; this pins the behaviour.
  const p = project();
  const stop = startEventsBridge({ projects: { list: () => [] } });
  const key = threadTurnKey(p.id, "a2a", a2aThreadId("ansel", "jaro"));
  let liveMidTurn = null;
  let stoppedMidTurn = false;
  let sawSignal = false;
  try {
    await assert.rejects(messagePeer({
      project: p, to: "jaro", from: "ansel", body: "arrancá", config: {},
      replyFn: async ({ signal, onEvent }) => {
        // While the peer works, the thread has something to show.
        await onEvent({ type: "tool_start", trace: { id: "t1", tool: "read_file" } });
        liveMidTurn = getActiveTurnByKey(key);
        // …and the Stop button is real: this is the exact call the abort route
        // makes, and until the tool path registered here it answered "nothing
        // to stop" while the peer kept burning tokens.
        stoppedMidTurn = abortActiveTurn(key);
        sawSignal = signal.aborted;
        throw new Error("stopped");
      },
    }), /stopped/);

    assert.ok(liveMidTurn, "the thread must show a turn in flight while the peer works");
    assert.equal(liveMidTurn.agent_slug, "jaro");
    assert.equal(liveMidTurn.channel, "a2a");
    assert.ok(
      liveMidTurn.parts?.some((part) => part.kind === "tool"),
      "and the work it has done, for whoever opens the thread mid-turn",
    );
    assert.ok(stoppedMidTurn, "abortActiveTurn found nothing to stop");
    assert.ok(sawSignal, "…and what it stopped was the peer");
    assert.equal(getActiveTurnByKey(key), null, "a finished turn stops showing as live");
    assert.ok(!listActiveTurns().some((turn) => turn.thread_id === a2aThreadId("ansel", "jaro")));
  } finally {
    stop();
    cleanupTempProject(p.path);
  }
});

test("the daemon re-tells the narration as a real, stoppable turn", () => {
  // The other half of the seam. Core emits; this is what turns the phases into
  // the registry entry a panel catches up from and `abortActiveTurn` reaches.
  const src = read("src/host/daemon/events-ws.js");
  assert.match(src, /onPeerTurnEvent/, "the bridge has to be subscribed");
  assert.match(src, /trackChannelTurn\(\{/, "through the SAME helper the HTTP route calls");
  assert.match(src, /key: threadTurnKey\(/, "under the key the inbox and abort look up");
  assert.match(src, /abort: typeof event\.abort === "function"/, "carrying the hook Stop pulls");
  // Deliberately NOT gated on connected clients, unlike every other subscriber
  // in that file: the registry is what a late panel reads and what cancel
  // aborts, and both have to exist with nobody watching.
  const bridge = src.slice(src.indexOf("const livePeerTurns"), src.indexOf("const unsubscribe = onMessageEvent"));
  assert.ok(!/_clients\.size/.test(bridge), "tracking a turn must not depend on somebody watching it");
});

test("the tool path is the one that needed this — the route already had it", () => {
  // Guard against the fix being undone by moving the narration somewhere that
  // only the HTTP path reaches. `runPeerAndFileReply` is where `send_to_agent`,
  // `call_agent`, background jobs and wake-ups all converge.
  const src = read("src/core/agent/a2a/file-reply.js");
  assert.match(src, /emitPeerTurnEvent/, "the shared funnel is what narrates");
  assert.match(src, /narratePeerTurn\(\{ project, from, to/);
});
