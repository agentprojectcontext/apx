import assert from "node:assert/strict";
import { test } from "node:test";
import { parseInline, parseMarkdown } from "./markdown.ts";

test("bold, italic, code and links become runs; stray marks stay text", () => {
  assert.deepEqual(parseInline("**Hoy:** ver `reel-26` y [docs](https://example.com) *ya*"), [
    { kind: "bold", children: [{ kind: "text", text: "Hoy:" }] },
    { kind: "text", text: " ver " },
    { kind: "code", text: "reel-26" },
    { kind: "text", text: " y " },
    { kind: "link", text: "docs", url: "https://example.com" },
    { kind: "text", text: " " },
    { kind: "italic", children: [{ kind: "text", text: "ya" }] },
  ]);
  assert.deepEqual(parseInline("2 * 3 = 6 and snake_case_name"), [
    { kind: "text", text: "2 * 3 = 6 and snake_case_name" },
  ]);
});

test("blocks: paragraphs split by blank lines, headings, lists and fenced code", () => {
  const blocks = parseMarkdown("# Plan\nUno\ndos\n\n- a\n- b\n1. x\n2) y\n```\nnpm test\n```\nfin");
  assert.deepEqual(
    blocks.map((block) => block.kind),
    ["heading", "paragraph", "list", "list", "code", "paragraph"],
  );
  const [, paragraph, bullets, numbers, code] = blocks;
  assert.deepEqual(paragraph, { kind: "paragraph", inline: [{ kind: "text", text: "Uno\ndos" }] });
  assert.equal(bullets?.kind === "list" && bullets.items.length, 2);
  assert.deepEqual(numbers?.kind === "list" && numbers.items.map((item) => item.marker), ["1.", "2."]);
  assert.deepEqual(code, { kind: "code", text: "npm test" });
});
