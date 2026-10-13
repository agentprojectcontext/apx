import assert from "node:assert/strict";
import { test } from "node:test";
import { parseInline, parseMarkdown, plainText } from "./markdown.ts";

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

test("quoted lines become one quote holding their own blocks, with blank quoted lines kept inside", () => {
  const blocks = parseMarkdown("Antes\n> Resumen:\n> • #54: uno\n> • #55: dos\n>\n> Siguen abiertos.\nDespués");
  assert.deepEqual(
    blocks.map((block) => block.kind),
    ["paragraph", "quote", "paragraph"],
  );
  const quote = blocks[1];
  assert.deepEqual(quote?.kind === "quote" && quote.blocks.map((block) => block.kind), [
    "paragraph",
    "list",
    "paragraph",
  ]);
});

test("a link into the desktop panel shows as its label on the phone", () => {
  const blocks = parseMarkdown("Prendelo en [Config › Escritorio](apx:settings/desktop).");
  assert.deepEqual(blocks, parseMarkdown("Prendelo en Config › Escritorio."));
});

test("a copy is the text as it reads: no marks, list markers kept, a quote's own words", () => {
  const blocks = parseMarkdown(
    "Te dejo esto:\n\n> Hi **team**!\n>\n> Docs: [site](https://example.com)\n\n- one\n- `two`",
  );
  assert.equal(plainText(blocks), "Te dejo esto:\n\nHi team!\n\nDocs: site\n\n• one\n• two");
  const quote = blocks[1];
  assert.equal(quote?.kind === "quote" && plainText(quote.blocks), "Hi team!\n\nDocs: site");
});
