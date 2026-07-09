// Goal-completion judge loop (OpenHands critic pattern): verdict parsing,
// config, the refinement driver, and the runSuperAgent gate. Offline.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-judge-home-"));

const { test } = await import("node:test");
const { default: assert } = await import("node:assert/strict");
const {
  judgeConfig,
  parseVerdict,
  summarizeTraceForJudge,
  judgeCompletion,
  buildJudgeFollowup,
  applyJudgeLoop,
} = await import("#core/agent/judge.js");
const { runSuperAgent } = await import("#core/agent/super-agent.js");
const { ProjectManager } = await import("#host/daemon/db.js");
const { makeTempProject, cleanupTempProject } = await import("./_helpers.js");

test("judgeConfig defaults and clamping", () => {
  assert.deepEqual(judgeConfig({}), {
    enabled: false,
    success_threshold: 0.6,
    max_iterations: 2,
    model: "",
  });
  const c = judgeConfig({
    super_agent: { judge: { enabled: true, success_threshold: 0.9, max_iterations: 99, model: "mock:j" } },
  });
  assert.equal(c.max_iterations, 5);
  assert.equal(c.success_threshold, 0.9);
});

test("parseVerdict: strict JSON, JSON with prose around it, junk", () => {
  assert.deepEqual(parseVerdict('{"score": 0.4, "reasoning": "tests missing", "missing": ["run tests"]}'), {
    score: 0.4,
    reasoning: "tests missing",
    missing: ["run tests"],
  });
  const wrapped = parseVerdict('Sure! {"score": 1.4, "reasoning": "done"} extra prose');
  assert.equal(wrapped.score, 1); // clamped
  assert.equal(parseVerdict("no json here"), null);
  assert.equal(parseVerdict('{"reasoning": "no score"}'), null);
});

test("summarizeTraceForJudge previews tools and errors", () => {
  const s = summarizeTraceForJudge([
    { tool: "read_file", result: { content: "abc" } },
    { tool: "run_shell", result: { error: "exit 1" } },
  ]);
  assert.match(s, /- read_file: /);
  assert.match(s, /- run_shell: error: exit 1/);
});

test("judgeCompletion: injected engine, parseable and unparseable replies", async () => {
  const cfg = { super_agent: { model: "mock:base", judge: { enabled: true } } };
  const seen = [];
  const good = await judgeCompletion({
    goal: "fix the bug",
    result: { text: "done", trace: [] },
    globalConfig: cfg,
    callEngineFn: async (params) => {
      seen.push(params);
      return { text: '{"score": 0.8, "reasoning": "looks complete", "missing": []}' };
    },
  });
  assert.equal(good.score, 0.8);
  assert.match(seen[0].messages[0].content, /ORIGINAL REQUEST:\nfix the bug/);

  const bad = await judgeCompletion({
    goal: "fix",
    result: { text: "x", trace: [] },
    globalConfig: cfg,
    callEngineFn: async () => ({ text: "not json" }),
  });
  assert.equal(bad, null);
  const thrown = await judgeCompletion({
    goal: "fix",
    result: { text: "x", trace: [] },
    globalConfig: cfg,
    callEngineFn: async () => { throw new Error("engine down"); },
  });
  assert.equal(thrown, null);
});

test("applyJudgeLoop: low score refines with a followup, merges usage/trace, attaches trail", async () => {
  const verdicts = [
    { score: 0.2, reasoning: "half done", missing: ["tests"] },
    { score: 0.9, reasoning: "complete", missing: [] },
  ];
  const followups = [];
  const events = [];
  const result = await applyJudgeLoop({
    initialResult: { text: "first", usage: { input_tokens: 10, output_tokens: 5 }, trace: [{ tool: "a" }] },
    cfg: { enabled: true, success_threshold: 0.6, max_iterations: 3 },
    onEvent: (e) => events.push(e),
    judgeFn: async () => verdicts.shift(),
    runFollowup: async (followup) => {
      followups.push(followup);
      return { text: "second", usage: { input_tokens: 7, output_tokens: 3 }, trace: [{ tool: "b" }] };
    },
  });
  assert.equal(followups.length, 1);
  assert.match(followups[0], /20% likely complete \(verification round 1\)/);
  assert.match(followups[0], /"tests"/);
  assert.equal(result.text, "second");
  assert.deepEqual(result.usage, { input_tokens: 17, output_tokens: 8 });
  assert.equal(result.trace.length, 2);
  assert.equal(result.judge.length, 2);
  assert.equal(events.filter((e) => e.type === "judge_verdict").length, 2);
  assert.equal(events[1].passed, true);
});

test("applyJudgeLoop: passing score or null verdict stops immediately", async () => {
  const pass = await applyJudgeLoop({
    initialResult: { text: "ok", usage: {}, trace: [] },
    cfg: { enabled: true, success_threshold: 0.6, max_iterations: 3 },
    judgeFn: async () => ({ score: 0.95, reasoning: "", missing: [] }),
    runFollowup: async () => { throw new Error("must not refine"); },
  });
  assert.equal(pass.judge.length, 1);

  const noJudge = await applyJudgeLoop({
    initialResult: { text: "ok", usage: {}, trace: [] },
    cfg: { enabled: true, success_threshold: 0.6, max_iterations: 3 },
    judgeFn: async () => null,
    runFollowup: async () => { throw new Error("must not refine"); },
  });
  assert.equal(noJudge.judge, undefined);
});

test("buildJudgeFollowup shapes the note without dictating wording", () => {
  const note = buildJudgeFollowup({ score: 0.33, reasoning: "no tests ran", missing: ["run tests", "update docs"] }, 2);
  assert.match(note, /NOT from the user/);
  assert.match(note, /33% likely complete \(verification round 2\)/);
  assert.match(note, /no tests ran/);
  assert.match(note, /"run tests", "update docs"/);
});

test("runSuperAgent: unusable judge (mock echo isn't JSON) accepts the result gracefully", async () => {
  const root = makeTempProject({ name: "Judge Project" });
  const projects = new ProjectManager({ engines: {} });
  projects.register(root);
  try {
    const result = await runSuperAgent({
      globalConfig: {
        super_agent: {
          enabled: true,
          model: "mock:base",
          permission_mode: "total",
          model_fallback: { enabled: false },
          judge: { enabled: true, success_threshold: 0.6, max_iterations: 2 },
        },
        memory: { enabled: false },
        engines: {},
      },
      projects,
      plugins: null,
      registries: null,
      prompt: "[mock:tool:list_projects] [mock:finish:all done]",
      channel: "api",
      completionContract: true,
      maxIters: 4,
    });
    assert.equal(result.text, "all done");
    assert.equal(result.judge, undefined, "null verdict → no refinement, no trail");
  } finally {
    cleanupTempProject(root);
  }
});
