// A tool called before its schema arrived: when to run it, when to bounce it.
//
// The bounce ("was not loaded … nothing ran") is right when the model guessed
// the arguments as well as the name. It is pure cost when the arguments were
// already correct — and worse than cost, because the retry that follows is
// byte-identical and used to land in the side-effect dedup as "already done".
// That pair is how four `call_runtime` calls on 2026-09-20 were reported to the
// owner as launched sessions while nothing had been spawned.
import { test } from "node:test";
import assert from "node:assert/strict";
import { argsSatisfySchema } from "#core/agent/loop/unloaded-tool.js";

const CALL_RUNTIME = {
  type: "function",
  function: {
    name: "call_runtime",
    parameters: {
      type: "object",
      properties: {
        runtime: { type: "string", enum: ["claude-code", "codex", "aider"] },
        prompt: { type: "string" },
        cwd: { type: "string" },
        background: { type: "boolean" },
        timeout_s: { type: "integer" },
      },
      required: ["runtime", "prompt"],
    },
  },
};

test("arguments that already fit the schema let the call through", () => {
  // Exactly the call Roby made, four times, each time bounced and then deduped.
  const r = argsSatisfySchema(CALL_RUNTIME, {
    runtime: "claude-code",
    prompt: "Trabajar sobre el código fuente de APX…",
    background: true,
  });
  assert.equal(r.ok, true);
});

test("a missing required field still bounces, with the reason", () => {
  const r = argsSatisfySchema(CALL_RUNTIME, { runtime: "claude-code" });
  assert.equal(r.ok, false);
  assert.match(r.reason, /missing required: prompt/);
});

test("an empty string does not count as a required field being present", () => {
  const r = argsSatisfySchema(CALL_RUNTIME, { runtime: "claude-code", prompt: "" });
  assert.equal(r.ok, false);
  assert.match(r.reason, /missing required/);
});

test("an invented argument bounces — that is the guess this path is for", () => {
  // The `complete_task({project, id})` shape from the header of the loop's own
  // comment: `id` is what list_tasks returns, the schema says `task`.
  const completeTask = {
    function: {
      parameters: {
        type: "object",
        properties: { task: { type: "string" }, action: { type: "string" } },
        required: ["task", "action"],
      },
    },
  };
  const r = argsSatisfySchema(completeTask, { project: "tecnomanu", id: "t_0vsz0p" });
  assert.equal(r.ok, false);
});

test("a value outside a declared enum bounces", () => {
  const r = argsSatisfySchema(CALL_RUNTIME, { runtime: "claude", prompt: "x" });
  assert.equal(r.ok, false);
  assert.match(r.reason, /not one of/);
});

test("a wrong primitive type bounces", () => {
  const r = argsSatisfySchema(CALL_RUNTIME, { runtime: "aider", prompt: "x", background: "true" });
  assert.equal(r.ok, false);
  assert.match(r.reason, /background should be boolean/);
  assert.equal(argsSatisfySchema(CALL_RUNTIME, { runtime: "aider", prompt: "x", timeout_s: 1.5 }).ok, false);
});

test("no schema to check against means bounce, never run on faith", () => {
  assert.equal(argsSatisfySchema(null, { anything: 1 }).ok, false);
  assert.equal(argsSatisfySchema({ function: {} }, {}).ok, false);
});

test("a tool that takes nothing runs with nothing", () => {
  const noArgs = { function: { parameters: { type: "object", properties: {} } } };
  assert.equal(argsSatisfySchema(noArgs, {}).ok, true);
  assert.equal(argsSatisfySchema(noArgs, undefined).ok, true);
});

test("a property with no declared type is not second-guessed", () => {
  const loose = {
    function: { parameters: { type: "object", properties: { payload: {} }, required: [] } },
  };
  assert.equal(argsSatisfySchema(loose, { payload: { nested: true } }).ok, true);
});
