import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveExecRequest } from "#interfaces/cli/commands/exec.js";

test("resolveExecRequest: no agent → super-agent", () => {
  const r = resolveExecRequest({ _: ["decime qué hora es"], flags: {} });
  assert.equal(r.useSuperAgent, true);
  assert.equal(r.slug, null);
  assert.equal(r.promptParts.join(" "), "decime qué hora es");
});

test("resolveExecRequest: -- separator style (prompt only in _)", () => {
  const r = resolveExecRequest({ _: ["hello world"], flags: {} });
  assert.equal(r.useSuperAgent, true);
  assert.deepEqual(r.promptParts, ["hello world"]);
});

test("resolveExecRequest: -a selects APC agent", () => {
  const r = resolveExecRequest({ _: ["Summarize"], flags: { agent: "reviewer" } });
  assert.equal(r.useSuperAgent, false);
  assert.equal(r.slug, "reviewer");
});

test("resolveExecRequest: --agent alias", () => {
  const r = resolveExecRequest({ _: ["hi"], flags: { agent: "coder" } });
  assert.equal(r.slug, "coder");
});

test("resolveExecRequest: legacy positional agent when 2+ args", () => {
  const r = resolveExecRequest({ _: ["reviewer", "Summarize role"], flags: {} });
  assert.equal(r.useSuperAgent, false);
  assert.equal(r.slug, "reviewer");
  assert.deepEqual(r.promptParts, ["Summarize role"]);
});

test("resolveExecRequest: super-agent positional alias still works", () => {
  const r = resolveExecRequest({ _: ["super-agent", "hello"], flags: {} });
  assert.equal(r.useSuperAgent, true);
  assert.equal(r.slug, null);
});

test("resolveExecRequest: -a wins over legacy positional", () => {
  const r = resolveExecRequest({
    _: ["ignored-slug", "prompt text"],
    flags: { agent: "real-agent" },
  });
  assert.equal(r.slug, "real-agent");
  assert.deepEqual(r.promptParts, ["ignored-slug", "prompt text"]);
});
