// Memory's Core: standing rules that ship on every turn, apart from the dated
// log that only retrieval reaches. A rule written on day one used to fall out
// of every prompt within a week, while this morning's log lines stayed in.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-memory-core-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx");

const { test, after } = await import("node:test");
const { default: assert } = await import("node:assert/strict");
const { upsertCoreFact, readCoreFacts, appendDatedBullet } = await import("#core/memory/dated-log.js");
const selfMemory = await import("#core/agent/self-memory.js");
const { default: remember } = await import("#core/agent/tools/handlers/remember.js");
const { buildSuperAgentSystem, buildNotebookCoreBlock } = await import("#core/agent/prompt-builder.js");
const { reviewTurnForMemory, turnWorthReviewing, parseReview } = await import("#core/memory/turn-review.js");
const { readProjectLocalMemory } = await import("#core/stores/project-memory.js");

after(() => fs.rmSync(TMP_HOME, { recursive: true, force: true }));

test("core facts live above the dated log, deduplicated, replaceable and bounded", () => {
  let r = upsertCoreFact("# Notebook\n\n## 2026-09-01\n- [10:00][web] a log line\n", "Posts are scheduled at 18:00.");
  assert.ok(r.added);
  assert.ok(r.body.indexOf("## Core") < r.body.indexOf("## 2026-09-01"));
  r = upsertCoreFact(r.body, "posts are scheduled at 18:00");
  assert.ok(r.duplicate);
  r = upsertCoreFact(r.body, "Posts are scheduled at 19:00.", { replaces: "Posts are scheduled at 18:00." });
  assert.equal(r.replaced, "Posts are scheduled at 18:00.");
  assert.deepEqual(readCoreFacts(r.body), ["Posts are scheduled at 19:00."]);
  const later = appendDatedBullet(r.body, "another log", { date: "2026-09-02", time: "09:00", channel: "web" });
  assert.deepEqual(readCoreFacts(later), ["Posts are scheduled at 19:00."], "the log grows without touching Core");
  let full = "# N\n";
  for (let i = 0; i < 3; i++) full = upsertCoreFact(full, `Fact ${i}.`, { max: 3 }).body;
  assert.ok(upsertCoreFact(full, "One more.", { max: 3 }).full);
});

test("remember(durable) writes Core; the prompt carries Core even when the broker answered", () => {
  const save = remember.makeHandler({ channel: "telegram", projects: { get: () => null, list: () => [] } });
  assert.equal(save({ note: "The owner wants short replies.", durable: true }).scope, "global-core");
  save({ note: "Rendered the reel.", channel: "web" });
  assert.deepEqual(selfMemory.readSelfCoreFacts(), ["The owner wants short replies."]);
  assert.doesNotMatch(selfMemory.readSelfMemoryForPrompt(), /short replies/, "the dated slice never repeats Core");
  assert.match(buildNotebookCoreBlock(), /The owner wants short replies/);
  const system = buildSuperAgentSystem({
    globalConfig: { super_agent: { model: "mock" } },
    projects: { list: () => [] },
    listSkills: () => [],
    channel: "telegram",
    memoryBlock: "# Relevant memory (cross-channel)\n[RELEVANT MEMORY]\n• something\n[/RELEVANT MEMORY]",
  });
  assert.match(system, /# Standing facts/);
  assert.match(system, /short replies/);
});

test("the post-turn review only runs on rule-shaped owner messages", () => {
  assert.ok(turnWorthReviewing("a partir de ahora los reels se agendan a las 18"));
  assert.ok(turnWorthReviewing("Never publish on the spot, always schedule"));
  assert.ok(!turnWorthReviewing("revisá los posts de mañana"));
  assert.ok(!turnWorthReviewing("siempre"), "too short to carry a rule");
  assert.deepEqual(parseReview('noise {"facts":[{"scope":"project","text":"Reels go out at 18:00."}]}'), [{ scope: "project", text: "Reels go out at 18:00." }]);
  assert.deepEqual(parseReview("not json"), []);
});

test("the review writes what the model extracted — global and project — and nothing twice", async () => {
  const projectDir = fs.mkdtempSync(path.join(TMP_HOME, "proj-"));
  const project = { id: 3, name: "Northwind", path: projectDir, storagePath: path.join(TMP_HOME, ".apx", "projects", "nw") };
  const answer = { text: '{"facts":[{"scope":"project","text":"Reels are scheduled, never published on the spot."},{"scope":"global","text":"The owner reviews posts at night."}]}' };
  const config = { memory: { compact_model: "mock:review" } };
  const written = await reviewTurnForMemory({
    userText: "nunca publiques en el momento, siempre agendá los reels",
    replyText: "Entendido.",
    project,
    config,
    callEngineFn: async () => answer,
  });
  assert.equal(written.length, 2);
  assert.match(readProjectLocalMemory(project), /## Core\n- Reels are scheduled/);
  assert.ok(selfMemory.readSelfCoreFacts().includes("The owner reviews posts at night."));
  const again = await reviewTurnForMemory({ userText: "siempre agendá los reels, nunca publiques", replyText: "", project, config, callEngineFn: async () => answer });
  assert.equal(again.length, 0, "already in Core");
  const off = await reviewTurnForMemory({ userText: "siempre agendá", replyText: "", config: { memory: { auto_review: false } }, callEngineFn: async () => answer });
  assert.equal(off.length, 0);
});
