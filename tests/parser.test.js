import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSessionFrontmatter } from "#core/apc/parser.js";

test("parseSessionFrontmatter — basic fields", () => {
  const text = `---
id: 2026-05-07-01
agent: sofia
title: Hello world
status: 🔄 In progress
started: 2026-05-07T14:32:00Z
---

# body`;
  const fm = parseSessionFrontmatter(text);
  assert.equal(fm.id, "2026-05-07-01");
  assert.equal(fm.agent, "sofia");
  assert.equal(fm.title, "Hello world");
  assert.equal(fm.started, "2026-05-07T14:32:00Z");
});
