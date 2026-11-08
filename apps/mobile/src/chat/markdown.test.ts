import assert from "node:assert/strict";
import { test } from "node:test";
import { parseInline, parseMarkdown, plainText, previewLine } from "./markdown.ts";

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

test("a fenced block keeps its language, so an email draft can show as a card", () => {
  const [mail] = parseMarkdown("```Email\nTo: user@example.com\n\nHi\n```");
  assert.deepEqual(mail, { kind: "code", text: "To: user@example.com\n\nHi", lang: "email" });
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

const LAUNCH = [
  "Here's a first cut of the **Q4 launch**:",
  "",
  "| Week | What | Who |",
  "|---|:---:|--:|",
  "| 1 | Freeze the catalog and fix `checkout` | Tomás |",
  "| 2 | Landing page and emails | Vera |",
  "",
  "I created two tasks.",
].join("\n");

test("a GFM table becomes a table: header, alignment and rows of inline cells", () => {
  const blocks = parseMarkdown(LAUNCH);
  assert.deepEqual(
    blocks.map((block) => block.kind),
    ["paragraph", "table", "paragraph"],
  );
  const table = blocks[1];
  assert.ok(table?.kind === "table");
  assert.deepEqual(table.header, [
    [{ kind: "text", text: "Week" }],
    [{ kind: "text", text: "What" }],
    [{ kind: "text", text: "Who" }],
  ]);
  assert.deepEqual(table.align, ["left", "center", "right"]);
  assert.equal(table.rows.length, 2);
  assert.deepEqual(table.rows[0]?.[1], [
    { kind: "text", text: "Freeze the catalog and fix " },
    { kind: "code", text: "checkout" },
  ]);
});

test("pipes without a delimiter row, or rows without outer pipes, still read as a table only when GFM says so", () => {
  assert.deepEqual(
    parseMarkdown("a | b\n--- | ---\n1 | 2").map((block) => block.kind),
    ["table"],
  );
  assert.deepEqual(
    parseMarkdown("Use a | b to pipe\nand more").map((block) => block.kind),
    ["paragraph"],
  );
  const [short] = parseMarkdown("| a | b |\n|---|---|\n| only |\n| 1 | 2 | 3 |");
  assert.ok(short?.kind === "table");
  assert.deepEqual(
    short.rows.map((row) => row.length),
    [2, 2],
  );
});

test("a copied table keeps one row per line with its cells apart", () => {
  assert.equal(plainText(parseMarkdown("| a | **b** |\n|---|---|\n| 1 | 2 |")), "a\tb\n1\t2");
});

test("a one-line preview is the words without marks, tables and lists included", () => {
  assert.equal(
    previewLine(LAUNCH),
    "Here's a first cut of the Q4 launch: Week What Who 1 Freeze the catalog and fix checkout Tomás 2 Landing page and emails Vera I created two tasks.",
  );
  assert.equal(previewLine("## Plan\n- one\n- `two`\n1. three"), "Plan one two 1. three");
  assert.equal(previewLine("Ver [docs](https://example.com) > ya"), "Ver docs > ya");
});

test("an escaped pipe stays inside its cell", () => {
  const [table] = parseMarkdown("| cmd | what |\n|---|---|\n| `a \\| b` | pipe |");
  assert.ok(table?.kind === "table");
  assert.deepEqual(table.rows[0]?.[0], [{ kind: "code", text: "a | b" }]);
});
