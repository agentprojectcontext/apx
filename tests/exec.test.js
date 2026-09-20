import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveExecRequest, execAbortTarget } from "#interfaces/cli/commands/exec.js";

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

// ---------------------------------------------------------------------------
// Ctrl+C — what the daemon is told to stop
//
// Before this, SIGINT killed the CLI and left the turn running: the daemon kept
// calling tools and persisted its answer into a thread nobody was watching,
// while the person who pressed the key believed they had cancelled something.
// Which turn to stop is addressed the way the client that started it can name
// it (host/daemon/api/turns.js), and that mapping is what these pin.
// ---------------------------------------------------------------------------

test("execAbortTarget: the super-agent is addressed by its channel", () => {
  assert.deepEqual(execAbortTarget({ channel: "cli" }), { channel: "cli" });
});

test("execAbortTarget: a code session is addressed by its id, not its channel", () => {
  assert.deepEqual(
    execAbortTarget({ channel: "code", codeSessionId: "2026-09-19-01" }),
    { code_session_id: "2026-09-19-01" },
  );
});

// The honest null. POST /agents/:slug/exec registers no active turn, so there
// is nothing for /turns/abort to find — and a target invented here would have
// the CLI report a cancellation that never happened.
test("execAbortTarget: an -a agent run has no target, and says so", () => {
  assert.equal(execAbortTarget({ channel: "cli", agentSlug: "rocky" }), null);
});

test("execAbortTarget: with nothing to name, nothing is claimed", () => {
  assert.equal(execAbortTarget({ channel: null }), null);
});
