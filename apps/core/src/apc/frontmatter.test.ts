import assert from "node:assert/strict";
import { test } from "node:test";
import { listField, parseFrontmatter } from "./frontmatter.ts";

test("frontmatter: flat fields, quotes, block scalars, lists and nested maps", () => {
  const { fields, body } = parseFrontmatter(
    [
      "---",
      "name: Arch",
      'role: "Software Architect"',
      "description: |",
      "  First line.",
      "  Second line.",
      "summary: >",
      "  folded",
      "  text",
      "skills:",
      "  - review",
      "  - adr",
      "metadata:",
      "  version: 2",
      "tools: browser, shell",
      "---",
      "",
      "# Arch",
      "Body.",
    ].join("\n"),
  );
  assert.equal(fields.name, "Arch");
  assert.equal(fields.role, "Software Architect");
  assert.equal(fields.description, "First line.\nSecond line.");
  assert.equal(fields.summary, "folded text");
  assert.deepEqual(fields.skills, ["review", "adr"]);
  assert.equal(fields["metadata.version"], "2");
  assert.deepEqual(listField(fields.tools), ["browser", "shell"]);
  assert.equal(body, "# Arch\nBody.");
});

test("a file without frontmatter is all body", () => {
  assert.deepEqual(parseFrontmatter("just text\n"), { fields: {}, body: "just text" });
});
