// Regression tests for the chit-chat protection rule that lives in
// src/core/agent/prompts/action-discipline.md and is now loaded into BOTH
// buildAgentSystem (project agents) and buildSuperAgentSystem (super-agent).
//
// We can't sit on top of a real LLM in unit tests, so what we verify here is:
//   1. The rule text is present in the file on disk.
//   2. The super-agent system prompt builder includes it.
//   3. buildAgentSystem (project agents) includes it too.
//   4. The rule survives across a config that omits super_agent.system, since
//      it gets appended AFTER the base prompt regardless.
//
// What we explicitly do NOT cover (and what task #31 still lists as TODO):
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
  __dirname,
  "..",
  "src",
  "core",
  "agent",
  "prompts",
  "action-discipline.md"
);

test("action-discipline.md contains both Action Discipline and Chit-chat sections", () => {
  const body = fs.readFileSync(RULE_PATH, "utf8");
  assert.match(body, /## Action Discipline/, "missing Action Discipline section");
  assert.match(body, /## Chit-chat/, "missing Chit-chat section");
  assert.match(body, /call `finish`/, "chit-chat must explicitly tell the model to call finish");
});

test("buildSuperAgentSystem appends action-discipline (chit-chat protection lives in super-agent prompt)", () => {
  const fakeProjects = { list: () => [] };
  const system = buildSuperAgentSystem({
    globalConfig: { super_agent: { model: "anthropic:claude-haiku-4-5" } },
    projects: fakeProjects,
    listSkills: () => [],
  });
  assert.match(system, /## Action Discipline/);
  assert.match(system, /## Chit-chat/);
});

test("buildAgentSystem (project agents) still appends action-discipline", () => {
  // The builder calls readAgentMemory which derives the storage root from the
  // project — give it a real tmp dir to avoid spurious failures inside paths.js.
  const root = fs.mkdtempSync(path.join(__dirname, "..", "tmp-chitchat-"));
  try {
    const project = { path: root, name: "x", storagePath: root };
    const agent = { slug: "alice", fields: { Description: "tester" } };
    const system = buildAgentSystem(project, agent);
    assert.match(system, /## Action Discipline/);
    assert.match(system, /## Chit-chat/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("super-agent-base prompt instructs against bare 'ok' acknowledgments (pre-existing rule)", () => {
  const base = fs.readFileSync(
    path.join(__dirname, "..", "src", "core", "agent", "prompts", "super-agent-base.md"),
    "utf8"
  );
  assert.match(base, /bare "ok"\/"checking"\/"one moment"/);
});
