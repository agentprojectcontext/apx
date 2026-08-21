// Goal-completion judge loop (OpenHands critic pattern): verdict parsing,
// config, the refinement driver, and the runSuperAgent gate. Offline.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-judge-home-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx"); // isolate the apx home too — HOME alone is overridden by the runner's APX_HOME

const { test } = await import("node:test");
const { default: assert } = await import("node:assert/strict");
const {
  judgeConfig,
  parseVerdict,
  summarizeTraceForJudge,
  judgeCompletion,
  buildJudgeFollowup,
  applyJudgeLoop,
  continuableTurn,
} = await import("#core/agent/judge.js");
const { runSuperAgent } = await import("#core/agent/super-agent.js");
const { ProjectManager } = await import("#host/daemon/db.js");
const { makeTempProject, cleanupTempProject } = await import("./_helpers.js");

test("judgeConfig defaults and clamping", () => {
  assert.deepEqual(judgeConfig({}), {
    enabled: false,
    continue_unfinished: true,
    success_threshold: 0.6,
    max_iterations: 2,
    model: "",
  });
  // Two independent switches: verifying a declared "done" stays opt-in, while
  // continuing a turn that stopped mid-task is on until it is turned off.
  assert.equal(judgeConfig({ super_agent: { judge: { continue_unfinished: false } } }).continue_unfinished, false);
  assert.equal(judgeConfig({ super_agent: { judge: { enabled: true } } }).continue_unfinished, true);
  const c = judgeConfig({
    super_agent: { judge: { enabled: true, success_threshold: 0.9, max_iterations: 99, model: "mock:j" } },
  });
  assert.equal(c.max_iterations, 5);
  assert.equal(c.success_threshold, 0.9);
});

test("continuableTurn: work that stopped, not chat and not a question", () => {
  assert.equal(continuableTurn({ trace: [{ tool: "read_file" }] }), true, "it worked and then stopped");
  assert.equal(continuableTurn({ trace: [] }), false, "chat has no half-done work to finish");
  assert.equal(continuableTurn({}), false, "a result with no trace is chat too");
  assert.equal(
    continuableTurn({ trace: [{ tool: "read_file" }, { tool: "ask_questions" }] }),
    false,
    "it is waiting for the user, not unfinished — the next move is theirs",
  );
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

// The conversational door: no completion contract, no "done" claim — the turn
// simply stopped calling tools. That is also what a model does when it announces
// its next step and writes no call, so a verdict decides whether it is finished.
test("runSuperAgent: a conversational turn that stopped mid-task gets continued", async () => {
  const root = makeTempProject({ name: "Judge Chat" });
  const projects = new ProjectManager({ engines: {} });
  projects.register(root);
  const base = {
    globalConfig: {
      super_agent: { enabled: true, model: "mock:base", permission_mode: "total", model_fallback: { enabled: false } },
      memory: { enabled: false },
      engines: {},
    },
    projects, plugins: null, registries: null,
    channel: "api",
    maxIters: 4,
  };
  try {
    const scores = [0.2, 0.9];
    const goals = [];
    const continued = await runSuperAgent({
      ...base,
      prompt: "[mock:tool:list_projects] regenerá el post",
      judgeCompletionFn: async ({ goal }) => {
        goals.push(goal);
        return { score: scores.shift(), reasoning: "half done", missing: ["subir el video"] };
      },
    });
    assert.equal(continued.judge.length, 2, "one verdict continued the turn, the next let it close");
    assert.match(goals[0], /regenerá el post/, "the judge scores the ORIGINAL request, not its own followup");

    // Chat has nothing to finish: judging every "hola" would be a call per line.
    const chat = await runSuperAgent({
      ...base,
      prompt: "hola",
      judgeCompletionFn: async () => { throw new Error("must not judge a toolless turn"); },
    });
    assert.equal(chat.judge, undefined);

    // And the whole thing is switchable.
    const off = await runSuperAgent({
      ...base,
      globalConfig: { ...base.globalConfig, super_agent: { ...base.globalConfig.super_agent, judge: { continue_unfinished: false } } },
      prompt: "[mock:tool:list_projects] regenerá el post",
      judgeCompletionFn: async () => { throw new Error("must not judge when it is switched off"); },
    });
    assert.equal(off.judge, undefined);
  } finally {
    cleanupTempProject(root);
  }
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
