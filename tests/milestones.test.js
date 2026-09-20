// Milestones — the store, the derived spine, and the merge of the two.
//
// The design claim being tested: a chat that ran for hours has a followable
// shape, and you can get it without a model. Two sources feed it — what the
// agent declared, and what the turns themselves say — and the interesting cases
// are where they meet: a step nobody declared still shows, a request nobody
// answered shows as OPEN rather than vanishing, and a declared failure beats a
// turn that otherwise looks fine.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-milestone-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx"); // APX_HOME, not HOME alone — the runner pins one sandbox otherwise

const {
  startMilestone, closeMilestone, updateMilestone, getMilestone,
  listMilestones, milestoneStats,
} = await import("#core/stores/milestones.js");
const { deriveSteps, stepTitle } = await import("#core/milestones/derive.js");
const {
  mergeTimeline, timelineStats, entryState, markRunningStep,
  conversationTimeline, projectTimeline,
} = await import("#core/milestones/index.js");
const { startConversation, appendTurn } = await import("#core/stores/conversations.js");

let STORE;
beforeEach(() => {
  STORE = fs.mkdtempSync(path.join(TMP_HOME, "store-"));
});

// --------------------------------------------------------------------------
// the store
// --------------------------------------------------------------------------

test("a milestone needs a title — there is nothing to show without one", () => {
  assert.throws(() => startMilestone(STORE, {}), /title required/);
  assert.throws(() => startMilestone(STORE, { title: "   " }), /title required/);
});

test("the default state is done, because a step is recorded once it is over", () => {
  const m = startMilestone(STORE, { title: "Reel analysed", state: "done" });
  assert.equal(m.state, "done");
  assert.ok(m.closed_at, "a terminal state closes on the way in");
});

test("open stays open until something closes it", () => {
  const m = startMilestone(STORE, { title: "Rendering", state: "open" });
  assert.equal(m.state, "open");
  assert.equal(m.closed_at, null);

  const closed = closeMilestone(STORE, m.id, "done", "12 min");
  assert.equal(closed.state, "done");
  assert.equal(closed.note, "12 min");
});

test("failed is recorded, not hidden — it is the state the feature exists for", () => {
  const m = startMilestone(STORE, { title: "Upload", state: "failed", note: "no credentials" });
  assert.equal(m.state, "failed");
  assert.equal(m.note, "no credentials");
  assert.equal(listMilestones(STORE, { state: "failed" }).length, 1);
});

test("dropped is not failed: nothing was attempted, so it must not count as a failure", () => {
  startMilestone(STORE, { title: "Wrong chat", state: "dropped" });
  const stats = milestoneStats(listMilestones(STORE));
  assert.equal(stats.failed, 0);
  assert.equal(stats.dropped, 1);
});

test("an unknown state is refused rather than silently stored", () => {
  assert.throws(() => startMilestone(STORE, { title: "x", state: "nearly" }), /unknown state/);
  const m = startMilestone(STORE, { title: "x" });
  assert.throws(() => closeMilestone(STORE, m.id, "nearly"), /unknown state/);
});

test("a milestone resolves by id prefix, the way an id read off a list is retyped", () => {
  const m = startMilestone(STORE, { title: "Reel analysed" });
  assert.equal(getMilestone(STORE, m.id).id, m.id);
  assert.equal(getMilestone(STORE, m.id.slice(0, 5)).id, m.id);
  assert.equal(getMilestone(STORE, "zz"), null, "too short to be a prefix");
  assert.equal(getMilestone(STORE, "nope_xyz"), null);
});

test("a patch cannot rewrite the identity or back-date the start", () => {
  const m = startMilestone(STORE, { title: "Draft", state: "open" });
  const patched = updateMilestone(STORE, m.id, {
    title: "Draft v2",
    id: "hacked",
    state: "done",
    started_at: "1999-01-01T00:00:00Z",
  });
  assert.equal(patched.id, m.id);
  assert.equal(patched.title, "Draft v2");
  assert.equal(patched.state, "open", "state moves through its own ops, never a patch");
  assert.equal(patched.started_at, m.started_at);
});

// Timestamps here have one-second resolution, and an agent closing out a turn
// declares its steps inside the same second. So this is not really about
// sorting — it is about whether three steps written back to back come out in
// the order they were written. They used to come out sorted by a random id
// suffix.
test("the list reads forward in time, even for steps written in the same second", () => {
  const a = startMilestone(STORE, { title: "First" });
  const b = startMilestone(STORE, { title: "Second" });
  const c = startMilestone(STORE, { title: "Third" });
  const ids = listMilestones(STORE).map((r) => r.id);
  assert.deepEqual(ids, [a.id, b.id, c.id]);
  assert.deepEqual(listMilestones(STORE).map((r) => r.title), ["First", "Second", "Third"]);
});

test("a half-written line does not blank the projection", () => {
  startMilestone(STORE, { title: "Good" });
  const dir = path.join(STORE, "milestones");
  const file = path.join(dir, fs.readdirSync(dir)[0]);
  fs.appendFileSync(file, "{not json\n");
  assert.equal(listMilestones(STORE).length, 1);
});

test("filters narrow to one chat", () => {
  startMilestone(STORE, { title: "A", conversation_id: "2026-09-19-01" });
  startMilestone(STORE, { title: "B", conversation_id: "2026-09-19-02" });
  const rows = listMilestones(STORE, { conversation_id: "2026-09-19-01" });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, "A");
});

// --------------------------------------------------------------------------
// the title, read off the request itself
// --------------------------------------------------------------------------

test("the title is the user's own words, not a paraphrase", () => {
  assert.equal(stepTitle("Make me a reel for Thursday"), "Make me a reel for Thursday");
});

test("the title drops the plumbing the upload path prepends", () => {
  assert.equal(stepTitle("[file: clip.mp4] cut this to 30 seconds"), "cut this to 30 seconds");
});

test("a request that opens with a paste is titled by its sentence, not the paste", () => {
  const title = stepTitle("```\nTypeError: boom\n```\nwhy does this fail?");
  assert.equal(title, "why does this fail?");
});

test("a long request is cut on a word boundary", () => {
  const long = "please " + "render ".repeat(40);
  const title = stepTitle(long);
  assert.ok(title.length <= 120, `got ${title.length}`);
  assert.ok(title.endsWith("…"));
  assert.ok(!/\srend…$/.test(title), "should not end mid-word");
});

// Seen on real data the day this shipped: twelve scheduled runs in a row all
// titled "Automation ID: r_… Automation memory: /Users/…". The runner prepends a
// machine header (core/routines/header.js) and the instruction starts under it,
// so titling from the top of the body names the plumbing instead of the work —
// and fills the rail while saying nothing, which is worse than no title.
test("a scheduled run is titled by its instruction, not by the automation header", () => {
  const body = [
    "Automation ID: r_tmnxat",
    "Automation memory: /path/to/apx/projects/default/routines/r_tmnxat/memory.md",
    "Last run: 2026-09-18T23:31:00.000Z (1789774260000)",
    "This run (UTC): 2026-09-19T04:31:01.445Z (1789792261445)",
    "",
    "Review the backlog and pick one item to move forward.",
  ].join("\n");
  assert.equal(stepTitle(body), "Review the backlog and pick one item to move forward.");
});

test("a header with nothing under it does not blank the title", () => {
  const onlyHeader = "Automation ID: r_x\nLast run: never";
  assert.match(stepTitle(onlyHeader), /Automation ID/);
});

// The strip is anchored on the literal header field, not on "looks like a
// key: value block" — a request of its own that opens that way keeps its words.
test("a real request that opens on a labelled line keeps it", () => {
  assert.equal(stepTitle("Note: check the deploy first"), "Note: check the deploy first");
});

test("an empty request yields an empty title rather than an invented one", () => {
  assert.equal(stepTitle(""), "");
  assert.equal(stepTitle("   "), "");
});

// --------------------------------------------------------------------------
// the derived spine
// --------------------------------------------------------------------------

const turn = (role, ts, content, meta) => ({ role, ts, content, ...(meta ? { meta } : {}) });

test("one request plus its answer is one step, however many iterations it took", () => {
  const steps = deriveSteps([
    turn("system", "2026-09-19T10:00:00Z", "you are…"),
    turn("user", "2026-09-19T10:00:01Z", "make the reel"),
    turn("tool", "2026-09-19T10:00:02Z", JSON.stringify({ tool: "read_file", result: { ok: 1 } })),
    turn("tool", "2026-09-19T10:00:03Z", JSON.stringify({ tool: "run_shell", result: { exit_code: 0 } })),
    turn("assistant", "2026-09-19T10:05:00Z", "done"),
  ]);
  assert.equal(steps.length, 1);
  assert.equal(steps[0].state, "done");
  assert.equal(steps[0].title, "make the reel");
  assert.equal(steps[0].tools.total, 2);
  assert.deepEqual(steps[0].tools.names, ["read_file", "run_shell"]);
});

test("a request nobody answered is OPEN — this is the half-finished work nothing reported", () => {
  const steps = deriveSteps([
    turn("user", "2026-09-19T10:00:00Z", "render it"),
    turn("tool", "2026-09-19T10:00:01Z", JSON.stringify({ tool: "run_shell", result: {} })),
  ]);
  assert.equal(steps.length, 1);
  assert.equal(steps[0].state, "open");
  assert.equal(steps[0].answered, false);
});

// Nine minutes is load-bearing here: a request its sender replaced inside the
// superseded window is bookkeeping, and only one left WAITING is the thing this
// state reports. See the block below.
test("asking again long after no answer came closes the first step as open", () => {
  const steps = deriveSteps([
    turn("user", "2026-09-19T10:00:00Z", "render it"),
    turn("user", "2026-09-19T10:09:00Z", "hello?"),
    turn("assistant", "2026-09-19T10:09:30Z", "sorry, here"),
  ]);
  assert.equal(steps.length, 2);
  assert.equal(steps[0].state, "open");
  assert.equal(steps[1].state, "done");
});

// --------------------------------------------------------------------------
// superseded — the requests nobody was waiting on
// --------------------------------------------------------------------------
//
// Measured before it was written: across 372 conversations on a real machine,
// 39 steps had no answer after them and 28 were closed by another message from
// the same person — 11 of those the identical text sent a second time. Counting
// all of that as half-finished work is how an alarm count becomes furniture.

test("the same request sent again did not go unanswered — it was sent again", () => {
  const steps = deriveSteps([
    turn("user", "2026-09-19T10:00:00Z", "podes ver el mcp?"),
    turn("user", "2026-09-19T10:00:07Z", "podes ver el mcp?"),
    turn("assistant", "2026-09-19T10:00:20Z", "sí, lo veo"),
  ]);
  assert.equal(steps[0].state, "superseded");
  assert.equal(steps[0].superseded_reason, "repeated");
  assert.equal(steps[1].state, "done");
});

// The clock must NOT get a vote on a resend. A person who waits ten minutes and
// then pastes their question again has still asked one question, and the real
// data has resends at three seconds and at ten minutes.
test("a resend is a resend however long its sender waited first", () => {
  const steps = deriveSteps([
    turn("user", "2026-09-19T10:00:00Z", "raro no veo tus tools ejecutandose"),
    turn("user", "2026-09-19T10:10:00Z", "raro no veo tus tools ejecutandose"),
  ]);
  assert.equal(steps[0].state, "superseded");
  assert.equal(steps[0].superseded_reason, "repeated");
});

test("a resend survives a retype — case and spacing are not a different question", () => {
  const steps = deriveSteps([
    turn("user", "2026-09-19T10:00:00Z", "Podes ver el MCP?"),
    turn("user", "2026-09-19T10:08:00Z", "podes ver  el mcp?\n"),
  ]);
  assert.equal(steps[0].superseded_reason, "repeated");
});

test("a request replaced seconds later was never left waiting", () => {
  const steps = deriveSteps([
    turn("user", "2026-09-19T10:00:00Z", "corre una tool de timing de 5 segundos"),
    turn("user", "2026-09-19T10:00:05Z", "contame en dos renglones qué es APX"),
    turn("assistant", "2026-09-19T10:00:30Z", "APX es…"),
  ]);
  assert.equal(steps[0].state, "superseded");
  assert.equal(steps[0].superseded_reason, "replaced");
});

// The case that started this: "pará" is not abandoned work, it is a person
// stopping one and saying never mind six seconds later.
test("a stop followed by a retraction is not half-finished work", () => {
  const steps = deriveSteps([
    turn("user", "2026-09-19T10:00:00Z", "para"),
    turn("user", "2026-09-19T10:00:06Z", "no era eso ya esta tranqui"),
    turn("assistant", "2026-09-19T10:00:12Z", "dale"),
  ]);
  assert.equal(steps[0].state, "superseded");
  assert.deepEqual(timelineStats(mergeTimeline(steps, [])).open, 0);
});

test("past the window it is waiting again, not replacing", () => {
  const steps = deriveSteps([
    turn("user", "2026-09-19T10:00:00Z", "dale termina el video"),
    turn("user", "2026-09-19T10:00:31Z", "?"),
  ]);
  assert.equal(steps[0].state, "open", "31s is outside the 30s window");
  assert.equal(steps[0].superseded_reason, null);
});

// WORK VETOES IT. A request that already spent tool calls and never answered
// lost that spend, and the next message does not give it back.
test("a request that already ran tools stays open however fast it was replaced", () => {
  const steps = deriveSteps([
    turn("user", "2026-09-19T10:00:00Z", "render it"),
    turn("tool", "2026-09-19T10:00:01Z", JSON.stringify({ tool: "run_shell", result: {} })),
    turn("user", "2026-09-19T10:00:03Z", "render it"),
  ]);
  assert.equal(steps[0].state, "open");
  assert.equal(steps[0].tools.total, 1);
});

test("a superseded step is kept, so the count still matches the chat", () => {
  const entries = mergeTimeline(
    deriveSteps([
      turn("user", "2026-09-19T10:00:00Z", "a"),
      turn("user", "2026-09-19T10:00:02Z", "a"),
      turn("assistant", "2026-09-19T10:00:09Z", "ok"),
    ]),
    []
  );
  const stats = timelineStats(entries);
  assert.equal(stats.total, 2, "both rows are there");
  assert.equal(stats.superseded, 1);
  assert.equal(stats.open, 0, "and the superseded one is not an alarm");
});

// --------------------------------------------------------------------------
// running — the turn being written as you look at it
// --------------------------------------------------------------------------

test("the last unanswered step is the one a live turn is writing", () => {
  const steps = markRunningStep(
    deriveSteps([
      turn("user", "2026-09-19T10:00:00Z", "render it"),
      turn("assistant", "2026-09-19T10:00:30Z", "done"),
      turn("user", "2026-09-19T10:01:00Z", "now upload it"),
    ])
  );
  assert.equal(steps[0].state, "done");
  assert.equal(steps[1].state, "running");
});

test("a chat whose last request was answered has nothing in flight to mark", () => {
  const steps = markRunningStep(
    deriveSteps([
      turn("user", "2026-09-19T10:00:00Z", "render it"),
      turn("assistant", "2026-09-19T10:00:30Z", "done"),
    ])
  );
  assert.equal(steps[0].state, "done");
});

test("only the LAST step is in flight — an older open one stays open", () => {
  const steps = markRunningStep(
    deriveSteps([
      turn("user", "2026-09-19T10:00:00Z", "render it"),
      turn("user", "2026-09-19T10:30:00Z", "hello?"),
      turn("assistant", "2026-09-19T10:30:10Z", "sorry"),
      turn("user", "2026-09-19T10:31:00Z", "now upload it"),
    ])
  );
  assert.equal(steps[0].state, "open", "abandoned half an hour ago and still abandoned");
  assert.equal(steps[2].state, "running");
});

test("a running turn is not counted as work nobody did", () => {
  const entries = mergeTimeline(
    markRunningStep(deriveSteps([turn("user", "2026-09-19T10:00:00Z", "render it")])),
    []
  );
  const stats = timelineStats(entries);
  assert.equal(stats.running, 1);
  assert.equal(stats.open, 0);
});

// The bug this outranking exists for: an agent declares its steps as it goes,
// so a turn in progress ALWAYS has open milestones under it. Reporting that as
// open is how "being answered right now" got announced as abandoned.
test("a turn in flight reports running even with its own steps still open", () => {
  const entries = mergeTimeline(
    markRunningStep(deriveSteps([turn("user", "2026-09-19T10:00:00Z", "render it")])),
    [startMilestone(STORE, { title: "Rendering", state: "open", started_at: "2026-09-19T10:00:05Z" })]
  );
  assert.equal(entryState(entries[0]), "running");
  assert.equal(timelineStats(entries).open, 0);
});

test("a failed tool makes the step failed, not done", () => {
  const steps = deriveSteps([
    turn("user", "2026-09-19T10:00:00Z", "upload it"),
    turn("tool", "2026-09-19T10:00:01Z", JSON.stringify({ tool: "run_shell", result: { error: "no such file" } })),
    turn("assistant", "2026-09-19T10:00:02Z", "could not upload"),
  ]);
  assert.equal(steps[0].state, "failed");
  assert.equal(steps[0].tools.failed, 1);
});

test("the assistant row's own tool_summary wins — it counts calls the transcript may not carry", () => {
  const steps = deriveSteps([
    turn("user", "2026-09-19T10:00:00Z", "do it"),
    turn("assistant", "2026-09-19T10:00:09Z", "done", {
      tool_summary: { total: 24, failed: 2, tools: [{ name: "run_shell", count: 24, failed: 2 }] },
      model: "anthropic:claude", agent_name: "APX",
    }),
  ]);
  assert.equal(steps[0].tools.total, 24);
  assert.equal(steps[0].state, "failed");
  assert.equal(steps[0].model, "anthropic:claude");
});

// A routine delivering into an agent's chat has no request in front of it. The
// step is real and has content; only the label is missing, and "Unnamed step"
// over a row full of work is the worst of both.
test("an agent-initiated turn is named by what it said, not left blank", () => {
  const steps = deriveSteps([
    turn("assistant", "2026-09-19T06:00:00Z", "Morning report: three items moved.", { tool_summary: { total: 3, failed: 0, tools: [] } }),
  ]);
  assert.equal(steps.length, 1);
  assert.equal(steps[0].title, "Morning report: three items moved.");
  assert.equal(steps[0].state, "done");
});

test("a request still wins over the answer when there is one", () => {
  const steps = deriveSteps([
    turn("user", "2026-09-19T06:00:00Z", "what moved today?"),
    turn("assistant", "2026-09-19T06:00:09Z", "Three items moved."),
  ]);
  assert.equal(steps[0].title, "what moved today?");
});

// The same turn arrives in two shapes: a conversation FILE keeps attribution
// under `meta`, a LEDGER row comes back from shapeLedgerMessage with the same
// fields at the top level. Reading only one of them is how a whole channel's
// timeline silently reports no work at all.
test("attribution is read whether it sits on the turn or under meta", () => {
  const shaped = deriveSteps([
    turn("user", "2026-09-19T10:00:00Z", "go"),
    {
      role: "assistant", ts: "2026-09-19T10:01:00Z", content: "done",
      tool_summary: { total: 5, failed: 2, tools: [{ name: "run_shell" }] },
      model: "groq:llama", agent_name: "Magui",
    },
  ]);
  assert.equal(shaped[0].tools.total, 5);
  assert.equal(shaped[0].state, "failed");
  assert.equal(shaped[0].model, "groq:llama");
  assert.equal(shaped[0].agent, "Magui");
});

test("a shaped tool row carries its result as a field, not as JSON in the body", () => {
  const steps = deriveSteps([
    turn("user", "2026-09-19T10:00:00Z", "go"),
    { role: "tool", ts: "2026-09-19T10:00:01Z", content: "", tool: "run_shell", result: { error: "nope" } },
    turn("assistant", "2026-09-19T10:00:02Z", "could not"),
  ]);
  assert.equal(steps[0].tools.total, 1);
  assert.equal(steps[0].tools.failed, 1);
  assert.deepEqual(steps[0].tools.names, ["run_shell"]);
});

// An a2a peer's calls live on the reply's own trace — they were moved off the
// ledger so a transcript could not eat the next turn's context. A timeline that
// only counted `tool` rows reported every peer as having done nothing.
test("a peer's work is counted from the trace on its reply", () => {
  const steps = deriveSteps([
    turn("user", "2026-09-19T10:00:00Z", "ask rocky"),
    {
      role: "assistant", ts: "2026-09-19T10:02:00Z", content: "asked",
      trace: [
        { tool: "read_file", result: { ok: 1 } },
        { tool: "send_telegram", result: { error: "no chat" } },
      ],
    },
  ]);
  assert.equal(steps[0].tools.total, 2);
  assert.equal(steps[0].tools.failed, 1);
  assert.equal(steps[0].state, "failed");
});

test("an unparseable tool row still counts as work rather than being guessed at", () => {
  const steps = deriveSteps([
    turn("user", "2026-09-19T10:00:00Z", "go"),
    turn("tool", "2026-09-19T10:00:01Z", "{broken"),
    turn("assistant", "2026-09-19T10:00:02Z", "ok"),
  ]);
  assert.equal(steps[0].tools.total, 1);
  assert.equal(steps[0].tools.failed, 0);
  assert.deepEqual(steps[0].tools.names, []);
});

// --------------------------------------------------------------------------
// the merge
// --------------------------------------------------------------------------

test("a declared milestone lands inside the request that produced it", () => {
  const steps = deriveSteps([
    turn("user", "2026-09-19T10:00:00Z", "make the reel"),
    turn("assistant", "2026-09-19T10:30:00Z", "done"),
    turn("user", "2026-09-19T11:00:00Z", "now post it"),
    turn("assistant", "2026-09-19T11:05:00Z", "posted"),
  ]);
  const declared = [
    { id: "m_1", title: "Material analysed", state: "done", started_at: "2026-09-19T10:10:00Z" },
    { id: "m_2", title: "Posted to TikTok", state: "done", started_at: "2026-09-19T11:02:00Z" },
  ];
  const entries = mergeTimeline(steps, declared);
  assert.equal(entries.length, 2);
  assert.deepEqual(entries[0].milestones.map((m) => m.id), ["m_1"]);
  assert.deepEqual(entries[1].milestones.map((m) => m.id), ["m_2"]);
});

test("a milestone declared after the answer still belongs to that request", () => {
  const steps = deriveSteps([
    turn("user", "2026-09-19T10:00:00Z", "make the reel"),
    turn("assistant", "2026-09-19T10:30:00Z", "done"),
  ]);
  // Between `ended_at` and the next request — the gap a span keyed on
  // `ended_at` would drop on the floor.
  const entries = mergeTimeline(steps, [
    { id: "m_1", title: "Delivered", state: "done", started_at: "2026-09-19T10:31:00Z" },
  ]);
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0].milestones.map((m) => m.id), ["m_1"]);
});

test("a milestone that matches no step is shown on its own, never dropped", () => {
  const steps = deriveSteps([turn("user", "2026-09-19T12:00:00Z", "later")]);
  const entries = mergeTimeline(steps, [
    { id: "m_early", title: "Before anything", state: "done", started_at: "2026-09-19T08:00:00Z" },
  ]);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].kind, "declared");
  assert.equal(entries[0].id, "m_early");
});

test("a declared failure beats a turn that otherwise looks fine", () => {
  const steps = deriveSteps([
    turn("user", "2026-09-19T10:00:00Z", "render and upload"),
    turn("assistant", "2026-09-19T10:30:00Z", "rendered; upload pending"),
  ]);
  const entries = mergeTimeline(steps, [
    { id: "m_1", title: "Upload", state: "failed", started_at: "2026-09-19T10:20:00Z" },
  ]);
  assert.equal(entries[0].state, "done", "the step itself answered cleanly");
  assert.equal(timelineStats(entries).failed, 1, "the rail still reports a failure");
});

// --------------------------------------------------------------------------
// end to end, over real files
// --------------------------------------------------------------------------

test("one chat's timeline reads its conversation file and its declared steps", async () => {
  const conv = startConversation({
    storagePath: STORE, agentSlug: "rocky", engine: "mock:test", system: "sys",
  });
  appendTurn({ filePath: conv.path, role: "user", content: "make the reel" });
  appendTurn({ filePath: conv.path, role: "assistant", content: "done", meta: { tool_summary: { total: 4, failed: 0, tools: [] } } });
  startMilestone(STORE, { title: "Material analysed", state: "done", conversation_id: conv.id });

  const { entries, stats } = await conversationTimeline({
    storagePath: STORE, agentSlug: "rocky", conversationId: conv.id,
  });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].title, "make the reel");
  assert.equal(entries[0].milestones.length, 1);
  assert.equal(stats.done, 1);
});

test("a chat with no file yet has an empty timeline rather than an error", async () => {
  const { entries, stats } = await conversationTimeline({
    storagePath: STORE, agentSlug: "ghost", conversationId: "2026-01-01-01",
  });
  assert.deepEqual(entries, []);
  assert.equal(stats.total, 0);
});

test("the cross-chat timeline is built from the ledger, one thread at a time", async () => {
  const dir = path.join(STORE, "messages");
  fs.mkdirSync(dir, { recursive: true });
  const rows = [
    { ts: "2026-09-19T10:00:00Z", channel: "telegram", type: "user", agent_slug: "rocky", body: "make the reel", meta: { conversation: "c1" } },
    { ts: "2026-09-19T10:05:00Z", channel: "telegram", type: "agent", agent_slug: "rocky", body: "done", meta: { conversation: "c1", tool_summary: { total: 2, failed: 0, tools: [] } } },
    { ts: "2026-09-19T11:00:00Z", channel: "web", type: "user", agent_slug: "magui", body: "post the recap", meta: { conversation: "c2" } },
  ];
  fs.writeFileSync(path.join(dir, "2026-09-19.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");

  const { entries, stats } = await projectTimeline({ storagePath: STORE, since: "2026-09-19T00:00:00Z" });
  assert.equal(entries.length, 2);
  // Two channels, two threads: the web request must not be paired with the
  // Telegram answer that happened to sit next to it in the day file.
  assert.equal(entries[0].channel, "telegram");
  assert.equal(entries[0].state, "done");
  assert.equal(entries[1].channel, "web");
  assert.equal(entries[1].state, "open", "asked on web, never answered");
  assert.equal(stats.open, 1);
});

// Seen live the day this shipped. Four milestones written at 23:51 by a CLI
// turn rendered underneath a scheduled run from 20:00 — because both had no
// conversation id, both keyed to "" in the grouping map, and the routine's
// open-ended last step swallowed them. A missing id is the ABSENCE of an
// identity, never a shared one.
test("a milestone with no conversation is not adopted by a thread that also has none", async () => {
  const dir = path.join(STORE, "messages");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "2026-09-19.jsonl"),
    [
      // A routine thread: ledger rows, and no conversation id on them either.
      { ts: "2026-09-19T20:00:00Z", channel: "routine", type: "user", agent_slug: "watcher", body: "watch the projects" },
      { ts: "2026-09-19T20:00:30Z", channel: "routine", type: "agent", agent_slug: "watcher", body: "nothing to report" },
    ].map((r) => JSON.stringify(r)).join("\n") + "\n"
  );
  // Recorded hours later, from a CLI turn that belongs to no conversation.
  startMilestone(STORE, { title: "Recorded from the CLI", state: "done", channel: "cli" });

  const { entries } = await projectTimeline({ storagePath: STORE, since: "2026-09-19T00:00:00Z" });
  const routineStep = entries.find((e) => e.kind === "derived");
  assert.deepEqual(routineStep.milestones, [], "the routine did not record this");

  const standalone = entries.find((e) => e.kind === "declared");
  assert.ok(standalone, "it must still show, on a row of its own");
  assert.equal(standalone.title, "Recorded from the CLI");
});

test("a milestone WITH a conversation id still lands inside that thread", async () => {
  const dir = path.join(STORE, "messages");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "2026-09-19.jsonl"),
    [
      { ts: "2026-09-19T10:00:00Z", channel: "web", type: "user", agent_slug: "rocky", body: "make it", meta: { conversation: "c1" } },
      { ts: "2026-09-19T10:30:00Z", channel: "web", type: "agent", agent_slug: "rocky", body: "done", meta: { conversation: "c1" } },
    ].map((r) => JSON.stringify(r)).join("\n") + "\n"
  );
  startMilestone(STORE, { title: "Rendered", state: "done", conversation_id: "c1" });

  const { entries } = await projectTimeline({ storagePath: STORE, since: "2026-09-19T00:00:00Z" });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].milestones.length, 1);
});

test("a declared milestone whose chat left no ledger rows still shows", async () => {
  startMilestone(STORE, { title: "Routine ran", state: "failed", conversation_id: "quiet" });
  const { entries } = await projectTimeline({ storagePath: STORE, since: "2000-01-01T00:00:00Z" });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].kind, "declared");
  assert.equal(entries[0].state, "failed");
});
