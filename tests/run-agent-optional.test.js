// `apx run` — the agent is optional.
//
// The agent only shapes the system prompt handed to the external CLI; the CLI
// has its own agency. Requiring one was confusing ("tell claude to be which
// agent?") and forced inventing a persona just to delegate a task. No agent now
// means a pass-through. This pins the resolution so the three shapes stay stable.
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveRunAgent } from "#interfaces/cli/commands/runtime.js";

test("no agent, quoted prompt → pass-through", () => {
  const r = resolveRunAgent({}, ["Refactor the parser"]);
  assert.equal(r.slug, null);
  assert.deepEqual(r.positionals, ["Refactor the parser"]);
});

test("-a / --agent flag wraps the run in that agent", () => {
  assert.equal(resolveRunAgent({ agent: "reviewer" }, ["do X"]).slug, "reviewer");
  assert.equal(resolveRunAgent({ a: "reviewer" }, ["do X"]).slug, "reviewer");
  // positionals stay the whole prompt when the agent came from a flag
  assert.deepEqual(resolveRunAgent({ agent: "reviewer" }, ["do X"]).positionals, ["do X"]);
});

test("legacy positional `apx run <agent> \"prompt\"` still works", () => {
  const r = resolveRunAgent({}, ["reviewer", "Review this repo"]);
  assert.equal(r.slug, "reviewer");
  assert.deepEqual(r.positionals, ["Review this repo"]);
});

test("a single positional is never treated as an agent", () => {
  // Even if it looks like a slug — one positional is the prompt, so a bare
  // pass-through can't be swallowed as an agent name.
  const r = resolveRunAgent({}, ["reviewer"]);
  assert.equal(r.slug, null);
  assert.deepEqual(r.positionals, ["reviewer"]);
});

test("a flag with no value does not count as an agent", () => {
  assert.equal(resolveRunAgent({ agent: true }, ["do X"]).slug, null);
});
