// A workflow runs a plan of delegations by code: items fan out under a cap, each goes through its stages without
// waiting for the others, a JSON answer is checked (and asked once more), `only_if` stops an item, the finish stage
// reads every result, and the asking agent gets it. Stopped, it wakes nobody; resumed, done steps are kept.
// See DECISIONS.md#d-272
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Part } from "@apx/protocol";
import type { AssistantItem } from "../providers/types.ts";
import { waitFor } from "../testkit/platform.ts";
import { offeredIn, say, scriptedLlm, startCore } from "./testkit.ts";

type Env = Awaited<ReturnType<typeof startCore>>;

const FOUND = {
  type: "object",
  properties: { found: { type: "boolean" }, note: { type: "string" } },
  required: ["found"],
};

/** The superagent's call of the workflow tool with `args`, then a short word once it returns. */
function caller(args: Record<string, unknown>) {
  return (said: string, afterTool: boolean) => {
    if (said.includes("<workflow_result")) return say("Workflow read.");
    if (afterTool) return say("Started it.");
    if (said.startsWith("run it")) {
      const message: AssistantItem = {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "w1", type: "function", function: { name: "workflow", arguments: JSON.stringify(args) } }],
      };
      return { message };
    }
    return say("ok");
  };
}

const isStep = (said: string) => said.includes("This is one step of the workflow") || said.includes("did not fit");
const workflowOf = (env: Env, thread: string) => {
  const [w] = env.core.store.workflows.ofThread(thread);
  assert.ok(w, "a workflow was started");
  return w;
};
const cardOf = (env: Env, thread: string) =>
  env.core.store.messages
    .list(thread)
    .flatMap((m) => m.parts)
    .find((p): p is Extract<Part, { type: "workflow" }> => p.type === "workflow");

async function startIn(env: Env): Promise<string> {
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "superagent", title: "map" });
  await env.client.call("threads.send", { thread: t.id, text: "run it" });
  return t.id;
}

test("items fan out under the cap, flow through stages without a barrier, and the result reaches the caller", async () => {
  const events: string[] = [];
  let active = 0;
  let most = 0;
  const stepTools: string[][] = [];
  const run = caller({
    name: "Map areas",
    items: ["alpha", "beta", "gamma", "delta"],
    stages: [
      {
        phase: "Find",
        worker: { name: "finder", instructions: "You find things." },
        task: "Find {{item}}",
        output: FOUND,
      },
      { phase: "Check", agent: "scout", task: "Check this: {{previous}}", only_if: "found" },
    ],
    finish: { phase: "Sum up", worker: { name: "summer", instructions: "You sum up." }, task: "Sum up {{results}}" },
    parallel: 2,
    wait_s: 0,
  });
  const llm = scriptedLlm(async (req, { said, afterTool }) => {
    if (!isStep(said)) return run(said, afterTool);
    stepTools.push(offeredIn(req));
    const item = /(?:Find|Check this:.*?note.*?) (alpha|beta|gamma|delta)/.exec(said)?.[1] ?? "?";
    const phase = /\(phase ([\w ]+)\)/.exec(said)?.[1] ?? "?";
    events.push(`start ${phase} ${item}`);
    active++;
    most = Math.max(most, active);
    await new Promise((r) => setTimeout(r, 40));
    active--;
    events.push(`end ${phase} ${item}`);
    if (phase === "Find")
      return say(`Looked.\n\`\`\`json\n${JSON.stringify({ found: item !== "gamma", note: `note ${item}` })}\n\`\`\``);
    if (phase === "Check") return say(`Checked ${item}: fine.`);
    return say(`Summary of ${(said.match(/Checked (\w+)/g) ?? []).length} checks.`);
  });
  const env = await startCore({ llm });
  try {
    const thread = await startIn(env);
    await waitFor(() => env.core.store.workflows.ofThread(thread)[0]?.state === "done", "the workflow ending", {
      ms: 15_000,
    });
    const w = workflowOf(env, thread);
    const steps = new Map(env.core.store.workflows.steps(w.id).map((s) => [s.key, s]));
    assert.equal(steps.size, 9, "4 items × 2 stages + finish");
    assert.equal(steps.get("s1.i2")?.state, "skipped", "gamma's check is skipped: found was false");
    assert.equal(steps.get("s1.i0")?.state, "done");
    assert.deepEqual(JSON.parse(steps.get("s0.i1")?.output ?? "{}"), { found: true, note: "note beta" });
    assert.ok(most <= 2, `at most two agents at once (saw ${most})`);
    // No barrier: alpha's check starts before the last find ends.
    assert.ok(events.indexOf("start Check alpha") < events.indexOf("end Find delta"), events.join(", "));
    assert.equal(steps.get("finish")?.state, "done");
    assert.match(w.result ?? "", /Summary of 3 checks/);
    // A workflow's agents ask nobody else.
    for (const tools of stepTools) assert.ok(!tools.includes("delegate") && !tools.includes("workflow"));
    const card = cardOf(env, thread);
    assert.equal(card?.state, "done");
    assert.deepEqual(
      card?.phases.map((p) => p.title),
      ["Find", "Check", "Sum up"],
    );
    assert.equal(card?.done, 9);
    await waitFor(
      () =>
        env.core.store.runs
          .list(thread, 10)
          .some((r) => r.input?.origin.kind === "workflow_result" && r.state === "completed"),
      "the caller woken with the result",
    );
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("a JSON answer that does not fit is asked once more; still wrong, the step fails and resume runs only it", async () => {
  let fixed = false;
  const asked: string[] = [];
  const run = caller({
    name: "Score",
    items: ["one", "two"],
    stages: [
      {
        phase: "Score",
        worker: { name: "scorer", instructions: "You score." },
        task: "Score {{item}}",
        output: { type: "object", properties: { score: { type: "integer" } }, required: ["score"] },
      },
    ],
    wait_s: 0,
  });
  const llm = scriptedLlm(async (req, { said, afterTool }) => {
    if (!isStep(said)) return run(said, afterTool);
    const item =
      /Score (one|two)/.exec(said)?.[1] ??
      /Score (one|two)/.exec(
        String(req.messages.find((m) => m.role === "user" && /Score (one|two)/.test(String(m.content)))?.content),
      )?.[1] ??
      "?";
    asked.push(`${item}${said.includes("did not fit") ? " again" : ""}`);
    if (item === "one") return say('```json\n{"score": 3}\n```');
    return say(fixed ? '```json\n{"score": 5}\n```' : "I think it is high.");
  });
  const env = await startCore({ llm });
  try {
    const thread = await startIn(env);
    await waitFor(() => env.core.store.workflows.ofThread(thread)[0]?.state === "failed", "the workflow failing", {
      ms: 15_000,
    });
    const w = workflowOf(env, thread);
    const two = env.core.store.workflows.step(w.id, "s0.i1");
    assert.equal(two?.state, "failed");
    assert.equal(two?.tries, 2, "asked once more in its session");
    assert.ok(asked.includes("two again"), asked.join(", "));
    assert.equal(cardOf(env, thread)?.state, "failed");
    fixed = true;
    const before = asked.filter((a) => a.startsWith("one")).length;
    const r = await env.client.call("workflows.resume", { workflow: w.id });
    assert.equal(r.resumed, true);
    await waitFor(() => env.core.store.workflows.get(w.id)?.state === "done", "the resumed workflow ending", {
      ms: 15_000,
    });
    assert.equal(asked.filter((a) => a.startsWith("one")).length, before, "the done step was not run again");
    assert.equal(JSON.parse(env.core.store.workflows.step(w.id, "s0.i1")?.output ?? "{}").score, 5);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("the owner's stop cancels the agents at work and wakes nobody", async () => {
  let release = () => {};
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const run = caller({
    name: "Slow",
    items: ["a", "b", "c"],
    stages: [{ phase: "Look", worker: { name: "looker", instructions: "You look." }, task: "Look at {{item}}" }],
    parallel: 2,
    wait_s: 0,
  });
  const llm = scriptedLlm(async (req, { said, afterTool }) => {
    if (!isStep(said)) return run(said, afterTool);
    await Promise.race([
      gate,
      new Promise<void>((_, reject) => req.signal.addEventListener("abort", () => reject(req.signal.reason))),
    ]);
    return say("looked");
  });
  const env = await startCore({ llm });
  try {
    const thread = await startIn(env);
    await waitFor(() => {
      const w = env.core.store.workflows.ofThread(thread)[0];
      return (
        Boolean(w) && env.core.store.workflows.steps(w?.id ?? "").filter((s) => s.state === "working").length === 2
      );
    }, "two steps at work");
    const w = workflowOf(env, thread);
    assert.equal((await env.client.call("workflows.stop", { workflow: w.id })).stopped, true);
    await waitFor(
      () => env.core.store.workflows.steps(w.id).every((s) => s.state !== "working"),
      "the steps at work canceled",
    );
    const steps = env.core.store.workflows.steps(w.id);
    assert.deepEqual(steps.map((s) => s.state).sort(), ["canceled", "canceled", "pending"]);
    assert.equal(env.core.store.workflows.get(w.id)?.state, "stopped");
    assert.equal(cardOf(env, thread)?.state, "stopped");
    await new Promise((r) => setTimeout(r, 100));
    assert.ok(!env.core.store.runs.list(thread, 10).some((r) => r.input?.origin.kind === "workflow_result"));
    release();
    assert.equal((await env.client.call("workflows.resume", { workflow: w.id })).resumed, true);
    await waitFor(() => env.core.store.workflows.get(w.id)?.state === "done", "the resumed workflow ending", {
      ms: 15_000,
    });
  } finally {
    release();
    await env.core.close();
    await env.cleanup();
  }
});

test("a plan that does not fit is refused with what to fix", async () => {
  const run = caller({
    name: "Bad",
    stages: [{ phase: "X", agent: "scout", worker: { name: "w", instructions: "i" }, task: "t" }],
  });
  const llm = scriptedLlm((_req, { said, afterTool }) => (isStep(said) ? say("?") : run(said, afterTool)));
  const env = await startCore({ llm });
  try {
    const thread = await startIn(env);
    await waitFor(() => env.core.store.runs.list(thread, 1)[0]?.state === "completed", "the turn");
    const step = env.core.store.runs.steps(env.core.store.runs.list(thread, 1)[0]?.id ?? "")[0];
    assert.equal(step?.tool, "workflow");
    assert.match(String(step?.result ?? ""), /an agent or a worker, not both/);
    assert.equal(env.core.store.workflows.ofThread(thread).length, 0);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
