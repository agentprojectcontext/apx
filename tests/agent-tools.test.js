import { test } from "node:test";
import assert from "node:assert/strict";
import {
  declaredAgentTools,
  resolveAgentAllowedTools,
  AGENT_CORE_TOOLS,
  AGENT_TOOL_ALIASES,
} from "#core/agent/agent-tools.js";
import { TOOLS } from "#core/agent/tools/names.js";
import { EDITOR_AGENT_TOOLS } from "#core/http-tools/catalog.js";

test("declaredAgentTools reads fields.Tools or tools", () => {
  assert.deepEqual(declaredAgentTools({ fields: { Tools: ["read_file", "glob"] } }), ["read_file", "glob"]);
  assert.deepEqual(declaredAgentTools({ tools: "read_file, glob" }), ["read_file", "glob"]);
  assert.deepEqual(declaredAgentTools({}), []);
});

// Capability is the default; narrowing is the deliberate act. The old default
// was a read/search/memory set, and it produced agents that could not do their
// job — a producer with no way to reach the MCP holding its publishing tools —
// each one diagnosed as a bug long after the run that needed it had failed.
test("no declaration ⇒ the broad default: the registry minus what belongs to the host", () => {
  const names = resolveAgentAllowedTools({ fields: { Tools: [] } });
  assert.ok(names.length > 40, `expected a broad set, got ${names.length}`);
  assert.ok(names.includes(TOOLS.READ_FILE));
  assert.ok(names.includes("glob") || names.includes(TOOLS.SEARCH_FILES));
  // The capabilities whose absence kept breaking real agents.
  assert.ok(names.includes(TOOLS.CALL_MCP), "an agent must be able to reach its MCPs");
  assert.ok(names.includes(TOOLS.LIST_MCP_TOOLS));
  assert.ok(names.includes(TOOLS.SEND_TELEGRAM));
  assert.ok(names.includes(TOOLS.CREATE_TASK));

  // What stays out is the super-agent's own: its identity, its privilege level,
  // and surgery on the install it is running inside.
  assert.equal(names.includes(TOOLS.SET_IDENTITY), false);
  assert.equal(names.includes(TOOLS.SET_PERMISSION_MODE), false);
  assert.equal(names.includes(TOOLS.ADD_PROJECT), false);
  assert.equal(names.includes(TOOLS.IMPORT_AGENT), false);
});

test("a declared list still narrows — that is the whole point of declaring one", () => {
  const names = resolveAgentAllowedTools({ fields: { Tools: ["read_file", "run_command"] } });
  assert.ok(names.includes(TOOLS.READ_FILE));
  assert.ok(names.includes(TOOLS.RUN_SHELL));
  // Narrow means narrow: everything NOT declared and not part of the floor
  // stays out.
  assert.equal(names.includes(TOOLS.SEND_TELEGRAM), false);
  assert.equal(names.includes(TOOLS.WRITE_FILE), false);
  assert.equal(names.includes(TOOLS.CREATE_TASK), false);
  assert.ok(names.length < 20, `a declared list must stay small, got ${names.length}`);
});

// The floor. A card that forgets `discover_tools` used to produce an agent that
// could not find the tools it was not given; one that forgets `ask_questions`
// could not hand a question back to a human; one that forgets `call_agent`
// could not answer another agent over a2a. Every one of those read as "the
// model is bad at this" rather than as a missing line in frontmatter.
test("every declared list gets the core floor on top of what it declared", () => {
  const names = resolveAgentAllowedTools({ fields: { Tools: ["read_file"] } });
  for (const core of AGENT_CORE_TOOLS) {
    assert.ok(names.includes(core), `${core} must always be granted`);
  }
  // …and the floor touches nothing in the world.
  for (const worldly of [TOOLS.RUN_SHELL, TOOLS.WRITE_FILE, TOOLS.SEND_TELEGRAM, TOOLS.CREATE_TASK]) {
    assert.equal(AGENT_CORE_TOOLS.includes(worldly), false, `${worldly} does not belong in the floor`);
  }
});

test("catalog aliases rewrite to callable native names", () => {
  const names = resolveAgentAllowedTools({
    fields: { Tools: ["memory_get", "agent_list", "project_info", "run_command"] },
  });
  for (const n of [TOOLS.READ_SELF_MEMORY, TOOLS.LIST_AGENTS, TOOLS.LIST_PROJECTS, TOOLS.RUN_SHELL]) {
    assert.ok(names.includes(n), `alias did not resolve to ${n}`);
  }
});

test("a declared native name is kept as-is", () => {
  const names = resolveAgentAllowedTools({
    fields: { Tools: ["read_file", "write_file", "asana_list_tasks", "send_telegram"] },
  });
  for (const n of [TOOLS.READ_FILE, TOOLS.WRITE_FILE, TOOLS.ASANA_LIST_TASKS, TOOLS.SEND_TELEGRAM]) {
    assert.ok(names.includes(n), `declared ${n} was not kept`);
  }
});

test("unknown names are dropped; duplicates collapse", () => {
  const names = resolveAgentAllowedTools({
    fields: { Tools: ["read_file", "not_a_tool", "read_file", "memory_get"] },
  });
  assert.equal(names.filter((n) => n === TOOLS.READ_FILE).length, 1, "duplicates must collapse");
  assert.ok(names.includes(TOOLS.READ_SELF_MEMORY));
  assert.equal(names.includes("not_a_tool"), false, "an unknown name must be dropped");
});

test("routine override replaces the agent card, including empty", () => {
  const agent = { fields: { Tools: ["read_file", "write_file"] } };
  assert.deepEqual(resolveAgentAllowedTools(agent, { override: ["send_telegram"] }), [TOOLS.SEND_TELEGRAM]);
  assert.deepEqual(resolveAgentAllowedTools(agent, { override: [] }), []);
});

test("EDITOR_AGENT_TOOLS maps to native names including edit/shell/skills", () => {
  const names = resolveAgentAllowedTools({ fields: { Tools: [...EDITOR_AGENT_TOOLS] } });
  assert.ok(names.includes(TOOLS.WRITE_FILE));
  assert.ok(names.includes(TOOLS.EDIT_FILE));
  assert.ok(names.includes(TOOLS.RUN_SHELL));
  assert.ok(names.includes(TOOLS.LIST_SKILLS));
  assert.ok(names.includes(TOOLS.LOAD_SKILL));
  assert.equal(names.includes(TOOLS.CALL_RUNTIME), false);
  assert.equal(names.includes("browser_navigate"), false);
});

test("AGENT_TOOL_ALIASES only points at real names or other catalog keys", () => {
  const names = resolveAgentAllowedTools({
    fields: { Tools: Object.keys(AGENT_TOOL_ALIASES) },
  });
  assert.ok(names.length > 0);
  assert.ok(names.every((n) => typeof n === "string" && n.length > 0));
});
