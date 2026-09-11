// The catalog an agent CARD is written against.
//
// It used to be served by /api/tools — core/http-tools/catalog.js, the daemon's
// own 43-entry HTTP surface. The two share a handful of names and nothing else,
// so the web picker offered `session_compact` (not a tool an agent can call:
// dropped in silence on save) and had no chip at all for 58 of the tools an
// agent CAN be granted, every task verb and call_agent among them.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { agentToolCatalog, listCallableToolNames } from "#core/agent/tools/registry.js";
import { AGENT_CORE_TOOLS, defaultAgentToolNames } from "#core/agent/agent-tools.js";
import { TOOL_DEFINITIONS } from "#core/http-tools/catalog.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PICKER = path.join(ROOT, "src/interfaces/web/src/components/agents/AgentToolsPicker.tsx");

test("the catalog covers every callable tool, once", () => {
  const catalog = agentToolCatalog();
  const names = catalog.map((t) => t.name);
  assert.deepEqual(names, [...new Set(names)], "a tool appears twice");
  assert.deepEqual(
    new Set(names),
    new Set(listCallableToolNames()),
    "the catalog and what the loop can dispatch must be the same set",
  );
});

test("it is NOT the HTTP tool catalog — that confusion is the bug it exists to fix", () => {
  const agentNames = new Set(agentToolCatalog().map((t) => t.name));
  // A tool the HTTP surface has and an agent cannot call must not be offered.
  assert.equal(agentNames.has("session_compact"), false);
  // …and the ones the old picker could never reach must be here.
  for (const n of ["create_task", "update_task", "get_task", "call_agent", "ask_questions", "git_status"]) {
    assert.ok(agentNames.has(n), `${n} must be grantable from the UI`);
  }
  assert.ok(agentNames.size > TOOL_DEFINITIONS.length, "the agent registry is the bigger of the two");
});

test("every tool lands in a named group — nothing falls into 'other'", () => {
  // "other" is what an unmapped tool gets, and a group called other is a group
  // nobody looks in: record_commitment and list_commitments sat there while
  // discover_tools({category:"tasks"}) returned the task verbs without them.
  const orphans = agentToolCatalog().filter((t) => !t.category || t.category === "other");
  assert.deepEqual(orphans.map((t) => t.name), [], "assign these a category in registry.js NATIVE_CATEGORY");
});

test("the core floor is real, grantable and small", () => {
  const grantable = new Set(defaultAgentToolNames());
  for (const name of AGENT_CORE_TOOLS) {
    assert.ok(grantable.has(name), `${name} is in the floor but an agent can never be granted it`);
  }
  // Still a floor, not a default set — the point of the cap is that every
  // addition has to be argued for. It went from 8 to 14 on 2026-09-11 when the
  // six task verbs moved in (tests/agent-task-floor.test.js says why); the
  // catalog it is drawn from has 91.
  assert.ok(AGENT_CORE_TOOLS.length <= 16, "the floor is a floor, not a default set");
});

test("the web picker has a label for every group the registry produces", () => {
  // A category added in core with no entry here still renders (the component
  // falls back to the raw id), but it renders untranslated — this is the nudge
  // to write the two strings while the category is fresh.
  //
  // Only groups the picker actually DRAWS count: a category is filtered out
  // when the tools in it are host-only (never grantable) or part of the core
  // floor (shown in their own locked strip, not as a group).
  const src = fs.readFileSync(PICKER, "utf8");
  const block = src.slice(src.indexOf("const GROUPS:"), src.indexOf("const GROUP_ORDER"));
  const known = new Set([...block.matchAll(/\["([a-z_]+)",/g)].map((m) => m[1]));

  const grantable = new Set(defaultAgentToolNames());
  const core = new Set(AGENT_CORE_TOOLS);
  const drawn = new Set(
    agentToolCatalog()
      .filter((tool) => grantable.has(tool.name) && !core.has(tool.name))
      .map((tool) => tool.category),
  );

  assert.ok(drawn.size > 10, `expected a real set of groups, got ${drawn.size}`);
  assert.deepEqual(
    [...drawn].filter((c) => !known.has(c)),
    [],
    "add these to GROUPS in AgentToolsPicker.tsx",
  );
});

test("the floor cannot reach the owner", () => {
  // Every tool that puts words in front of a PERSON is a grant, never a floor.
  // send_to_agent is the subtle one: it looks like pure a2a plumbing, but `to`
  // accepts the super-agent, and the super-agent owns the channel to the owner.
  // A card narrowed on purpose — the CEO template spends three paragraphs
  // saying it has no channel of its own — must not get that back from a default.
  for (const channel of ["send_telegram", "send_whatsapp", "send_to_agent"]) {
    assert.equal(
      AGENT_CORE_TOOLS.includes(channel),
      false,
      `${channel} reaches a person: declare it on the cards that should have it`,
    );
  }
  // …while the project-scoped one stays, because answering a peer is what
  // makes an agent reachable at all.
  assert.ok(AGENT_CORE_TOOLS.includes("call_agent"));
});
