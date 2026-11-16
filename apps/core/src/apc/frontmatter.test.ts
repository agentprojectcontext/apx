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

test("frontmatter edge cases: empty frontmatter, a ---- line in the body, CRLF and PyYAML lists", () => {
  assert.deepEqual(parseFrontmatter("---\n---\nBody here.\n"), { fields: {}, body: "Body here." });
  const p = parseFrontmatter("---\r\nname: A\r\ntools:\r\n- browser\r\n- shell\r\n---\r\nText\r\n----\r\nMore\r\n");
  assert.equal(p.fields.name, "A");
  assert.deepEqual(p.fields.tools, ["browser", "shell"]);
  assert.equal(p.body, "Text\n----\nMore");
});

test("only exact trimmed fences close the header, including at the end of a file", () => {
  assert.deepEqual(parseFrontmatter(" \t---\r\nname: example\r\n \t--- \t"), {
    fields: { name: "example" },
    body: "",
  });
  for (const text of ["---", "---\nname: example", "---\nname: example\n----\n--- text\n", "---\n"]) {
    assert.deepEqual(parseFrontmatter(text), { fields: {}, body: text.trim() });
  }
});

test("a large body preserves lines, later fences and CRLF normalization without becoming fields", () => {
  const lines = [
    "# Instructions",
    ...Array.from({ length: 10000 }, (_, i) => `Step ${i}: read the guide.`),
    "---",
    "name: body-only",
    "End.",
  ];
  for (const newline of ["\n", "\r\n"]) {
    const text = [
      "---",
      "name: example",
      "description: >",
      "  First line.",
      "  Second line.",
      "---",
      "",
      ...lines,
      "",
    ].join(newline);
    assert.deepEqual(parseFrontmatter(text), {
      fields: { name: "example", description: "First line. Second line." },
      body: lines.join("\n"),
    });
  }
});

test("a map whose entries hold lists stays a map", () => {
  const { fields } = parseFrontmatter(
    "---\nmetadata:\n  tags:\n    - a\n    - b\n  category: devops\nservers:\n  docs:\n    args:\n      - -y\n---\n",
  );
  assert.deepEqual(fields["metadata.tags"], ["a", "b"]);
  assert.equal(fields["metadata.category"], "devops");
  assert.deepEqual(fields["servers.docs.args"], ["-y"]);
});
