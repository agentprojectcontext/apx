import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { LogEntry } from "../domain/model-log.ts";
import type { RunRecord } from "../domain/runs.ts";
import { waitFor } from "../testkit/platform.ts";
import { UNTRUSTED_MARK, untrusted } from "../tools/result.ts";
import { projectHistory } from "./context.ts";
import { say, scriptedLlm, startCore } from "./testkit.ts";
import { COMPACT_AT_CHARS, contextFill, planCompaction, titleFromText, validSummary, validTitle } from "./upkeep.ts";

const SUMMARY = [
  "## Goal",
  "- Launch Northwind in March.",
  "## Facts and decisions",
  "- Budget is 12k.",
  "## Done",
  "- none",
  "## Open",
  "- Pick a venue.",
  "## References",
  "- none",
].join("\n");

let badSummary = false;
const llm = scriptedLlm((req) => {
  const system = String(req.messages[0]?.content);
  const usage = { input: 120, output: 6 };
  if (system.startsWith("You compress"))
    return { ...say(badSummary ? "Sure! Here is a summary: it went fine." : SUMMARY), usage };
  if (system.startsWith("Write a title")) return { ...say('"Northwind launch plan."'), usage };
  // A model with a known window whose last call read most of it.
  if (String(req.messages.at(-1)?.content).includes("fill the window"))
    return { ...say("noted"), model: "fake/claude-test", usage: { input: 170_000, output: 5 } };
  return say("noted");
});

let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  env = await startCore({ llm, aux: true });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

const entry = (seq: number, run: string, item: object): LogEntry => ({ seq, run_id: run, item });

test("summaries must have the fixed shape; titles are cleaned; a title without a model comes from the text", () => {
  assert.equal(validSummary(`Here you go:\n${SUMMARY}`), SUMMARY);
  assert.equal(validSummary(SUMMARY.replace("## Open", "## Next")), undefined);
  assert.equal(validSummary("## Goal\n## Done"), undefined);
  assert.equal(validTitle('"Northwind launch plan."'), "Northwind launch plan");
  assert.equal(validTitle("x"), undefined);
  assert.equal(titleFromText("  fix   the login page  "), "fix the login page");
  assert.match(titleFromText("a ".repeat(80)) ?? "", /…$/);
});

test("compaction waits until the thread is long, keeps the newest turns and marks outside content", () => {
  const big = "x".repeat(Math.ceil(COMPACT_AT_CHARS / 5));
  const entries: LogEntry[] = [];
  for (let i = 0; i < 6; i++) {
    entries.push(entry(i * 2 + 1, `r${i}`, { role: "user", content: i === 0 ? untrusted("web", {}, "page") : "q" }));
    entries.push(entry(i * 2 + 2, `r${i}`, { role: "assistant", content: big }));
  }
  assert.equal(planCompaction(entries.slice(0, 4), undefined, false), undefined);
  const plan = planCompaction(entries, undefined, false);
  assert.ok(plan);
  assert.ok(plan.runs >= 2 && plan.runs <= 5);
  assert.equal(plan.untrusted, true);
  const history = projectHistory(entries, 120_000, { upto: plan.upto, summary: SUMMARY, untrusted: true });
  assert.equal(history[0]?.role, "user");
  assert.match(String(history[0]?.content), /\[summary of the earlier conversation/);
  assert.ok(String(history[0]?.content).includes(UNTRUSTED_MARK), "a summary of outside content stays untrusted");
  assert.ok(!history.some((m) => String(m.content).includes("page")), "summarized turns are left out");
});

test("a new chat gets a title from the auxiliary model; one the owner gave stays", async () => {
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "superagent" });
  await env.client.call("threads.send", { thread: t.id, text: "Help me plan the Northwind launch for March" });
  await env.settle(t.id);
  await waitFor(async () => (await env.client.call("threads.get", { thread: t.id })).thread.title !== "Roby");
  assert.equal((await env.client.call("threads.get", { thread: t.id })).thread.title, "Northwind launch plan");
  // No run holds that call: its tokens are kept apart, with the chat it was about.
  const { aux } = await env.client.call("usage.summary", { thread: t.id });
  assert.deepEqual(aux, [{ purpose: "title", model: "fake/fake-1", calls: 1, input: 120, output: 6 }]);
  const all = await env.client.call("usage.summary", {});
  assert.ok(all.aux.some((a) => a.purpose === "title" && a.calls >= 1));

  const mine = await env.client.call("threads.create", { kind: "loose", agent_id: "superagent", title: "Budget" });
  await env.client.call("threads.send", { thread: mine.id, text: "hello" });
  await env.settle(mine.id);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal((await env.client.call("threads.get", { thread: mine.id })).thread.title, "Budget");
});

test("threads.compact folds older turns into a summary the next turn starts from", async () => {
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "superagent" });
  for (const n of [1, 2, 3, 4, 5, 6]) {
    await env.client.call("threads.send", { thread: t.id, text: `step ${n}` });
    await env.settle(t.id);
  }
  badSummary = true;
  const rejected = await env.client.call("threads.compact", { thread: t.id });
  assert.equal(rejected.compacted, false);
  assert.match(rejected.reason ?? "", /shape/);
  badSummary = false;

  // Two requests at once summarize once (the second joins the first or finds nothing left).
  const [r, again] = await Promise.all([
    env.client.call("threads.compact", { thread: t.id }),
    env.client.call("threads.compact", { thread: t.id }),
  ]);
  assert.ok(r.compacted || again.compacted);
  await env.client.call("threads.send", { thread: t.id, text: "step 7" });
  await env.settle(t.id);
  const call = llm.calls.findLast((c) => String(c.messages.at(-1)?.content).includes("step 7"));
  const seen = call?.messages.map((m) => String(m.content)) ?? [];
  assert.match(seen[1] ?? "", /\[summary of the earlier conversation[\s\S]*## Goal/);
  assert.ok(!seen.some((c) => c.includes("step 1")), "summarized turns are not sent again");
  assert.ok(
    seen.some((c) => c.includes("step 6")),
    "the newest turns stay verbatim",
  );
  // A second summary a few turns later updates the same notice instead of adding another.
  for (const n of [8, 9, 10, 11, 12]) {
    await env.client.call("threads.send", { thread: t.id, text: `step ${n}` });
    await env.settle(t.id);
  }
  assert.equal((await env.client.call("threads.compact", { thread: t.id })).compacted, true);
  const { messages } = await env.client.call("threads.get", { thread: t.id });
  const notices = messages.filter((m) => m.parts.some((p) => p.type === "notice" && p.code === "thread.compacted"));
  assert.equal(notices.length, 1);
  // The rejected summary was spent all the same.
  const { aux } = await env.client.call("usage.summary", { thread: t.id });
  assert.ok((aux.find((a) => a.purpose === "summary")?.calls ?? 0) >= 2);
});

test("old tool output counts as the stub the model sees: long reads alone do not summarize the chat", () => {
  const huge = "y".repeat(COMPACT_AT_CHARS);
  const entries: LogEntry[] = [];
  for (let i = 0; i < 6; i++) {
    entries.push(entry(i * 3 + 1, `r${i}`, { role: "user", content: "read the log" }));
    entries.push(
      entry(i * 3 + 2, `r${i}`, {
        role: "assistant",
        content: null,
        tool_calls: [{ id: `c${i}`, type: "function", function: { name: "file_read", arguments: "{}" } }],
      }),
    );
    entries.push(entry(i * 3 + 3, `r${i}`, { role: "tool", tool_call_id: `c${i}`, content: i < 4 ? huge : "short" }));
  }
  assert.equal(planCompaction(entries, undefined, false), undefined, "four huge old outputs are four stubs");
});

test("a short chat is compacted once its model's last call read 80% of the window", () => {
  const entries: LogEntry[] = [];
  for (let i = 0; i < 6; i++) {
    entries.push(entry(i * 2 + 1, `r${i}`, { role: "user", content: `q${i}` }));
    entries.push(entry(i * 2 + 2, `r${i}`, { role: "assistant", content: "short answer" }));
  }
  assert.equal(planCompaction(entries, undefined, false), undefined, "small in characters, window unknown");
  assert.equal(planCompaction(entries, undefined, false, { used: 150_000, window: 200_000 }), undefined);
  const plan = planCompaction(entries, undefined, false, { used: 160_000, window: 200_000 });
  assert.ok(plan, "80% of the window is full");
  assert.equal(plan.runs, 2, "the newest four turns stay verbatim");
});

test("the context fill comes from the newest finished native run, measured after the last summary", () => {
  const run = (o: Partial<RunRecord>): RunRecord =>
    ({
      id: "r",
      thread_id: "t",
      agent_id: "a",
      state: "completed",
      started_at: "2026-01-02T00:00:00.000Z",
      ...o,
    }) as RunRecord;
  const used = { input: 9000, output: 10, context: 170_000 };
  const done = { harness: "native" as const, ended_at: "2026-01-02T00:01:00.000Z" };
  assert.deepEqual(contextFill([run({ ...done, model: "anthropic/claude-sonnet-4-5", usage: used })]), {
    used: 170_000,
    window: 200_000,
  });
  assert.deepEqual(contextFill([run({ ...done, model: "fake/fake-1", usage: { ...used, window: 32_000 } })]), {
    used: 170_000,
    window: 32_000,
  });
  assert.equal(contextFill([run({ ...done, model: "fake/fake-1", usage: used })]), undefined, "window unknown");
  assert.equal(contextFill([run({ ...done, model: "claude/opus", harness: "claude", usage: used })]), undefined);
  assert.equal(contextFill([run({ ...done, model: "x/claude", usage: { input: 1, output: 1 } })]), undefined);
  // A turn still going says nothing yet: the newest finished one counts.
  const busy = run({ harness: "native", state: "working", model: "x/claude" });
  assert.equal(contextFill([busy, run({ ...done, model: "x/claude", usage: used })])?.used, 170_000);
  // Read before the summary that followed it: that size is gone.
  const epoch = { upto: 4, summary: SUMMARY, untrusted: false, runs: 2, at: "2026-01-03T00:00:00.000Z" };
  assert.equal(contextFill([run({ ...done, model: "x/claude", usage: used })], epoch), undefined);
});

test("after a turn that filled the model's window the chat is summarized on its own", async () => {
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "superagent" });
  for (const n of [1, 2, 3, 4, 5]) {
    await env.client.call("threads.send", { thread: t.id, text: `short step ${n}` });
    await env.settle(t.id);
  }
  const compacted = async () =>
    (await env.client.call("threads.get", { thread: t.id })).messages.some((m) =>
      m.parts.some((p) => p.type === "notice" && p.code === "thread.compacted"),
    );
  assert.equal(await compacted(), false, "a short chat with no known window is not summarized");
  await env.client.call("threads.send", { thread: t.id, text: "now fill the window" });
  await env.settle(t.id);
  await waitFor(compacted);
});
