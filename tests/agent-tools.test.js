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

test("empty declaration falls back to the safe default set, not the super-agent registry", () => {
  const names = resolveAgentAllowedTools({ fields: { Tools: [] } });
  assert.ok(names.includes(TOOLS.READ_FILE), "defaults include read_file");
  assert.ok(names.includes("glob") || names.includes(TOOLS.SEARCH_FILES), "defaults include search (glob)");
  assert.equal(names.includes(TOOLS.CALL_RUNTIME), false, "must not inherit call_runtime");
  assert.equal(names.includes(TOOLS.SEND_TELEGRAM), false, "must not inherit send_telegram");
  assert.equal(names.includes(TOOLS.SET_PERMISSION_MODE), false);
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
