import { test } from "node:test";
import assert from "node:assert/strict";
import {
  declaredAgentTools,
  resolveAgentAllowedTools,
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
  assert.deepEqual(names, [TOOLS.READ_FILE, TOOLS.RUN_SHELL]);
});

test("catalog aliases rewrite to callable native names", () => {
  const names = resolveAgentAllowedTools({
    fields: { Tools: ["memory_get", "agent_list", "project_info", "run_command"] },
  });
  assert.deepEqual(names, [
    TOOLS.READ_SELF_MEMORY,
    TOOLS.LIST_AGENTS,
    TOOLS.LIST_PROJECTS,
    TOOLS.RUN_SHELL,
  ]);
});

test("a declared native name is kept as-is", () => {
  const names = resolveAgentAllowedTools({
    fields: { Tools: ["read_file", "write_file", "asana_list_tasks", "send_telegram"] },
  });
  assert.deepEqual(names, [
    TOOLS.READ_FILE,
    TOOLS.WRITE_FILE,
    TOOLS.ASANA_LIST_TASKS,
    TOOLS.SEND_TELEGRAM,
  ]);
});

test("unknown names are dropped; duplicates collapse", () => {
  const names = resolveAgentAllowedTools({
    fields: { Tools: ["read_file", "not_a_tool", "read_file", "memory_get"] },
  });
  assert.deepEqual(names, [TOOLS.READ_FILE, TOOLS.READ_SELF_MEMORY]);
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
