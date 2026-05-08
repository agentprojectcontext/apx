import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAgentsMd, parseSessionFrontmatter } from "../src/core/parser.js";

test("parseAgentsMd — single agent with reserved fields", () => {
  const md = `# Agents

## sofia
- **Role**: Support
- **Model**: claude-haiku-4-5
- **Skills**: customer-support, escalation
- **Language**: es-AR
`;
  const agents = parseAgentsMd(md);
  assert.equal(agents.length, 1);
  assert.equal(agents[0].slug, "sofia");
  assert.equal(agents[0].fields.Role, "Support");
  assert.equal(agents[0].fields.Model, "claude-haiku-4-5");
  assert.deepEqual(agents[0].fields.Skills, ["customer-support", "escalation"]);
  assert.equal(agents[0].fields.Language, "es-AR");
});

test("parseAgentsMd — HTML comments are ignored (template fragments)", () => {
  const md = `# Agents

<!-- Add an agent like this:
## fake
- **Role**: Test
-->

## sofia
- **Role**: Support
`;
  const agents = parseAgentsMd(md);
  assert.equal(agents.length, 1, "the commented fake agent must not be parsed");
  assert.equal(agents[0].slug, "sofia");
});

test("parseAgentsMd — invalid slugs are skipped", () => {
  const md = `# Agents

## Not A Slug
- **Role**: ignored

## ok-slug
- **Role**: kept
`;
  const agents = parseAgentsMd(md);
  assert.equal(agents.length, 1);
  assert.equal(agents[0].slug, "ok-slug");
});

test("parseAgentsMd — multi-line continuation merges into the previous field", () => {
  const md = `# Agents

## sofia
- **Description**: A long description that
  continues on the next line
  and one more.
- **Role**: Support
`;
  const a = parseAgentsMd(md)[0];
  assert.match(a.fields.Description, /^A long description that continues on the next line and one more\.?/);
  assert.equal(a.fields.Role, "Support");
});

test("parseSessionFrontmatter — basic fields", () => {
  const text = `---
id: 2026-05-07-01
agent: sofia
title: Hello world
status: 🔄 En progreso
started: 2026-05-07T14:32:00Z
---

# body`;
  const fm = parseSessionFrontmatter(text);
  assert.equal(fm.id, "2026-05-07-01");
  assert.equal(fm.agent, "sofia");
  assert.equal(fm.title, "Hello world");
  assert.equal(fm.started, "2026-05-07T14:32:00Z");
});
