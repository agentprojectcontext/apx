// Regression tests for the chit-chat protection rule.
//
// After the prompt refactor the rule lives in
//   src/core/agent/prompts/discipline/action.md
// and is layered into BOTH buildAgentSystem (project agents) and
// buildSuperAgentSystem (super-agent) via prompt-builder.js.
//
// We can't sit on top of a real LLM in unit tests, so what we verify here is:
//   1. The rule text is present in the file on disk.
//   2. The super-agent system prompt builder includes it.
//   3. buildAgentSystem (project agents) includes it too.
//
// What we explicitly do NOT cover:
//   - Behavioural test against a weak model (Groq/Qwen) confirming that a
//     bare "hola" actually triggers a `finish` call and not a 400 error.
//     That has to happen against the daemon with real credentials.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSuperAgentSystem } from "#core/agent/prompt-builder.js";
import { buildAgentSystem } from "#core/agent/build-agent-system.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RULE_PATH = path.join(
  __dirname, "..", "src", "core", "agent", "prompts", "discipline", "action.md"
);

test("discipline/action.md contains both Action discipline and Chit-chat sections", () => {
  const body = fs.readFileSync(RULE_PATH, "utf8");
  assert.match(body, /Action discipline/i, "missing Action discipline section");
  assert.match(body, /Chit-chat/i, "missing Chit-chat section");
  assert.match(body, /`finish`/, "chit-chat must explicitly name the `finish` tool");
});

test("buildSuperAgentSystem appends action-discipline (chit-chat protection lives in super-agent prompt)", () => {
  const fakeProjects = { list: () => [] };
  const system = buildSuperAgentSystem({
    globalConfig: { super_agent: { model: "anthropic:claude-haiku-4-5" } },
    projects: fakeProjects,
    listSkills: () => [],
  });
  assert.match(system, /Action discipline/i);
  assert.match(system, /Chit-chat/i);
});

test("buildAgentSystem (project agents) still appends action-discipline", () => {
  // The builder calls readAgentMemory which derives the storage root from the
  // project — give it a real tmp dir to avoid spurious failures inside paths.js.
  const root = fs.mkdtempSync(path.join(__dirname, "..", "tmp-chitchat-"));
  try {
    const project = { path: root, name: "x", storagePath: root };
    const agent = { slug: "alice", fields: { Description: "tester" } };
    const system = buildAgentSystem(project, agent);
    assert.match(system, /Action discipline/i);
    assert.match(system, /Chit-chat/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("agent-base prompt blocks bare 'ok' / 'checking' acknowledgments via the action-discipline rule", () => {
  const action = fs.readFileSync(RULE_PATH, "utf8");
  // The exact wording changed in the refactor, but the rule must still
  // explicitly forbid the empty-acknowledgment patterns ("Ok", "On it", …).
  assert.match(action, /Empty acknowledgments/i);
  assert.match(action, /"Ok"/);
  assert.match(action, /On it/);
});
