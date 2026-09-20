import { test } from "node:test";
import assert from "node:assert/strict";
import { ProjectManager } from "#host/daemon/db.js";
import { runSuperAgent } from "#core/agent/super-agent.js";
import { makeTempProject, cleanupTempProject } from "./_helpers.js";

/** The turn's STEPS, in order. `turn_usage` rides the same channel and is not
 *  one: it is the running token total, emitted once per model call so a live
 *  surface can show what an answer is costing before it lands. */
const steps = (events) => events.filter((e) => e.type !== "turn_usage").map((e) => e.type);

test("runSuperAgent emits progress events as tools execute", async () => {
  const root = makeTempProject({ name: "Progress Project" });
  const projects = new ProjectManager({ engines: {} });
  projects.register(root);
  const events = [];

  try {
    const result = await runSuperAgent({
      globalConfig: {
        super_agent: {
          enabled: true,
          model: "mock",
          permission_mode: "total",
        },
      },
      projects,
      plugins: null,
      registries: null,
      prompt: "[mock:tool:list_projects]",
      onEvent: (event) => events.push(event),
    });

    assert.match(result.text, /\[mock:mock\] received/);
    // `turn_usage` is an accounting note, not a step of the turn: the running
    // total, once per model call, so a surface can say what an answer is
    // costing WHILE it is being written. The step vocabulary is read without
    // it; it gets its own assertion below.
    assert.deepEqual(steps(events), [
      "model_start",
      "tool_start",
      "tool_result",
      "model_start",
    ]);
    const spend = events.filter((e) => e.type === "turn_usage");
    assert.equal(spend.length, 2, "one running total per model call");
    assert.ok(spend.every((e) => e.usage && typeof e.usage.input_tokens === "number"));
    const started = events.find((e) => e.type === "tool_start");
    const finished = events.find((e) => e.type === "tool_result");
    assert.equal(started.trace.tool, "list_projects");
    assert.equal(started.trace.pending, true);
    assert.equal(finished.trace.tool, "list_projects");
    assert.ok(finished.trace.result[0].name);
  } finally {
    cleanupTempProject(root);
  }
});

test("completionContract: loop keeps going until the model calls finish", async () => {
  const root = makeTempProject({ name: "Contract Project" });
  const projects = new ProjectManager({ engines: {} });
  projects.register(root);
  const events = [];

  try {
    const result = await runSuperAgent({
      globalConfig: {
        super_agent: { enabled: true, model: "mock", permission_mode: "total" },
      },
      projects,
      plugins: null,
      registries: null,
      // First model call → run list_projects; once a tool result exists the
      // mock emits finish("done after tools").
      prompt: "[mock:tool:list_projects][mock:finish:done after tools]",
      channel: "code",
      completionContract: true,
      onEvent: (event) => events.push(event),
    });

    // The finish summary becomes the final text — not the mock's echo.
    assert.equal(result.text, "done after tools");
    // A real tool ran, then the turn ended via the finish summary.
    assert.deepEqual(steps(events), [
      "model_start",
      "tool_start",
      "tool_result",
      "model_start",
      "assistant_text",
    ]);
    assert.equal(events.find((e) => e.type === "tool_start").trace.tool, "list_projects");
    assert.equal(events.find((e) => e.type === "assistant_text").text, "done after tools");
  } finally {
    cleanupTempProject(root);
  }
});

test("loop reserves the final step for a tool-free, model-authored wrap-up", async () => {
  const root = makeTempProject({ name: "WrapUp Project" });
  const projects = new ProjectManager({ engines: {} });
  projects.register(root);
  const events = [];

  try {
    const result = await runSuperAgent({
      globalConfig: {
        super_agent: { enabled: true, model: "mock", permission_mode: "total" },
      },
      projects,
      plugins: null,
      registries: null,
      // The model never stops on its own — it re-fires the tool every step it's
      // offered one. The loop must run out of action steps and close the turn
      // with a tool-free wrap-up instead of going silent.
      prompt: "[mock:loop:list_projects]",
      maxIters: 3,
      onEvent: (event) => events.push(event),
    });

    // The final reply is the model's own prose (mock echo), NOT empty.
    assert.ok(result.text && result.text.trim().length > 0, "wrap-up text must be non-empty");
    assert.match(result.text, /\[mock:mock\] received/);

    const types = steps(events);
    // The last model turn is flagged as the wrap-up, and no tool ran on it:
    // exactly the 2 looped tool calls (steps 1 and 2) produced tool_results.
    assert.ok(types.includes("final_wrapup"), "a final_wrapup step must run");
    assert.equal(types.filter((t) => t === "tool_result").length, 2);
    // Nothing executes after the wrap-up — it's the closing step. Measured
    // over STEPS: the wrap-up's own spend is reported after it, and a note
    // about what just happened is not something happening next.
    assert.equal(types[types.length - 1], "final_wrapup");
  } finally {
    cleanupTempProject(root);
  }
});

test("empty model turn retries without spending the budget and never ends silent-by-exhaustion", async () => {
  const root = makeTempProject({ name: "Empty Project" });
  const projects = new ProjectManager({ engines: {} });
  projects.register(root);
  const events = [];

  try {
    const result = await runSuperAgent({
      globalConfig: {
        super_agent: { enabled: true, model: "mock", permission_mode: "total" },
      },
      projects,
      plugins: null,
      registries: null,
      // Every call comes back empty (no text, no tools) — a dud model.
      prompt: "[mock:empty]",
      maxIters: 5,
      onEvent: (event) => events.push(event),
    });

    const retries = events.filter((e) => e.type === "empty_retry");
    // Bounded retries fire (MAX_EMPTY_RETRIES = 2), each on iteration 1 — proof
    // the dud turns did NOT advance/consume the tool budget.
    assert.equal(retries.length, 2, "exactly 2 empty retries");
    assert.deepEqual(retries.map((e) => e.attempt), [1, 2]);
    assert.ok(retries.every((e) => e.iteration === 1), "retries must not advance the iteration");
    // runAgent itself yields empty here; the surface's last-resort floor is what
    // guarantees the user sees a non-silent reply (asserted in telegram-fallback).
    assert.equal((result.text || "").trim(), "");
  } finally {
    cleanupTempProject(root);
  }
});
