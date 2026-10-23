import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { LogEntry } from "../domain/model-log.ts";
import { UNTRUSTED_MARK, untrusted } from "../tools/result.ts";
import { projectHistory } from "./context.ts";
import { say, scriptedLlm, startCore } from "./testkit.ts";
import { COMPACT_AT_CHARS, planCompaction, titleFromText, validSummary, validTitle } from "./upkeep.ts";

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
  return say("noted");
});

let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  env = await startCore({ llm, aux: true });
});
after(async () => {
  await env.core.close();
  env.cleanup();
});

const until = async (check: () => Promise<boolean>, ms = 3000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("condition never met");
};

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
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
  await env.client.call("threads.send", { thread: t.id, text: "Help me plan the Northwind launch for March" });
  await env.settle(t.id);
  await until(async () => (await env.client.call("threads.get", { thread: t.id })).thread.title !== "Roby");
  assert.equal((await env.client.call("threads.get", { thread: t.id })).thread.title, "Northwind launch plan");
  // No run holds that call: its tokens are kept apart, with the chat it was about.
  const { aux } = await env.client.call("usage.summary", { thread: t.id });
  assert.deepEqual(aux, [{ purpose: "title", model: "fake/fake-1", calls: 1, input: 120, output: 6 }]);
  const all = await env.client.call("usage.summary", {});
  assert.ok(all.aux.some((a) => a.purpose === "title" && a.calls >= 1));

  const mine = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", title: "Budget" });
  await env.client.call("threads.send", { thread: mine.id, text: "hello" });
  await env.settle(mine.id);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal((await env.client.call("threads.get", { thread: mine.id })).thread.title, "Budget");
});

test("threads.compact folds older turns into a summary the next turn starts from", async () => {
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
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
