import assert from "node:assert/strict";
import { test } from "node:test";
import { A2UI_BASIC_CATALOG, type InlineNode, parseInlineBlock } from "./inline-ui.ts";

const movies = {
  title: "Movie ideas",
  example: true,
  items: [
    {
      id: "m1",
      eyebrow: "Movie · 2024",
      title: "The quiet moon",
      description: "A space drama.",
      image: "med_abc123",
      badges: ["Drama", "Drama", "108 min"],
      fields: [{ label: "Year", value: "2024" }],
      details: "An invented journey to the moon.",
    },
    { id: "m2", title: "Northbound" },
  ],
  fallback: "Two movie ideas: The quiet moon and Northbound.",
};

test("a results list becomes a grid of cards in APX Kit order", () => {
  const block = parseInlineBlock("apx-cards", JSON.stringify(movies));
  assert.equal(block?.kind, "view");
  if (block?.kind !== "view") return;
  assert.deepEqual(block.view, {
    title: "Movie ideas",
    example: true,
    root: {
      kind: "grid",
      children: [
        {
          kind: "card",
          children: [
            { kind: "image", media: "med_abc123", alt: "The quiet moon", shape: "banner" },
            { kind: "text", text: "Movie · 2024", style: "eyebrow" },
            { kind: "text", text: "The quiet moon", style: "title" },
            { kind: "text", text: "A space drama.", style: "body" },
            { kind: "badges", items: ["Drama", "108 min"] },
            { kind: "fields", rows: [{ label: "Year", value: "2024" }] },
            { kind: "details", children: [{ kind: "text", text: "An invented journey to the moon.", style: "body" }] },
          ],
        },
        { kind: "card", children: [{ kind: "text", text: "Northbound", style: "title" }] },
      ],
    },
  });
});

test("a list layout puts the picture beside the words", () => {
  const block = parseInlineBlock("apx-cards", JSON.stringify({ ...movies, layout: "list" }));
  assert.equal(block?.kind === "view" && block.view.root.kind, "column");
  const first = block?.kind === "view" && "children" in block.view.root ? block.view.root.children[0] : undefined;
  assert.equal(first?.kind === "card" && first.children[0]?.kind, "row");
});

test("a block that asks for what APX does not draw shows its fallback, never a remote picture", () => {
  for (const image of ["https://example.com/poster.jpg", "javascript:alert(1)", "asset:movie"]) {
    const items = [{ ...movies.items[0], image }];
    assert.deepEqual(parseInlineBlock("apx-cards", JSON.stringify({ ...movies, items })), {
      kind: "fallback",
      text: movies.fallback,
    });
  }
  const many = Array.from({ length: 13 }, (_, i) => ({ id: `m${i}`, title: "x" }));
  assert.equal(parseInlineBlock("apx-cards", JSON.stringify({ ...movies, items: many }))?.kind, "fallback");
});

test("malformed blocks and other languages are not read", () => {
  assert.equal(parseInlineBlock("apx-cards", "{not json"), undefined);
  assert.equal(parseInlineBlock("apx-cards", JSON.stringify({ items: movies.items })), undefined);
  assert.equal(parseInlineBlock("json", JSON.stringify(movies)), undefined);
  assert.equal(parseInlineBlock("apx-cards", "x".repeat(40_000)), undefined);
});

const golf = (components: Record<string, unknown>[]) => ({
  fallback: "A golf routine: warm up, then putting.",
  messages: [
    { version: "1.0", createSurface: { surfaceId: "golf", catalogId: A2UI_BASIC_CATALOG } },
    { version: "1.0", updateComponents: { surfaceId: "golf", components } },
  ],
});

test("A2UI's basic catalog is drawn with APX pieces", () => {
  const block = parseInlineBlock(
    "a2ui",
    JSON.stringify(
      golf([
        { id: "root", component: "List", direction: "horizontal", children: ["c1"] },
        { id: "c1", component: "Card", child: "col" },
        { id: "col", component: "Column", children: ["img", "icon", "t", "b", "cap", "div", "more"] },
        { id: "img", component: "Image", url: "med_golf1", variant: "header", description: "A green" },
        { id: "icon", component: "Icon", name: "star" },
        { id: "t", component: "Text", text: "Warm up", weight: "bold" },
        { id: "b", component: "Text", text: "Ten minutes of swings." },
        { id: "cap", component: "Text", text: "Day 1", variant: "caption" },
        { id: "div", component: "Divider" },
        { id: "more", component: "Modal", trigger: "mt", content: "mc" },
        { id: "mt", component: "Text", text: "How to" },
        { id: "mc", component: "Text", text: "Keep the head still." },
      ]),
    ),
  );
  assert.equal(block?.kind, "view");
  if (block?.kind !== "view") return;
  const card = (block.view.root as Extract<InlineNode, { kind: "grid" }>).children[0];
  assert.deepEqual(card, {
    kind: "card",
    children: [
      {
        kind: "column",
        children: [
          { kind: "image", media: "med_golf1", shape: "banner", alt: "A green" },
          { kind: "text", text: "Warm up", style: "title" },
          { kind: "text", text: "Ten minutes of swings.", style: "body" },
          { kind: "text", text: "Day 1", style: "caption" },
          { kind: "divider" },
          {
            kind: "details",
            label: "How to",
            children: [{ kind: "text", text: "Keep the head still.", style: "body" }],
          },
        ],
      },
    ],
  });
});

test("A2UI actions, bindings, unknown parts, cycles and loose parts fall back", () => {
  const cases = [
    [
      { id: "root", component: "Button", child: "t", action: { event: { name: "buy" } } },
      { id: "t", component: "Text", text: "Buy" },
    ],
    [{ id: "root", component: "Text", text: { "@path": "/name" } }],
    [
      { id: "root", component: "Column", children: ["a"] },
      { id: "a", component: "Column", children: ["root"] },
    ],
    [
      { id: "root", component: "Text", text: "Hi" },
      { id: "loose", component: "Text", text: "Nobody points here" },
    ],
    [{ id: "root", component: "Image", url: "https://example.com/x.png" }],
  ];
  for (const components of cases)
    assert.equal(
      parseInlineBlock("a2ui", JSON.stringify(golf(components)))?.kind,
      "fallback",
      JSON.stringify(components),
    );
  const other = golf([{ id: "root", component: "Text", text: "Hi" }]);
  (other.messages[0] as { createSurface: { catalogId: string } }).createSurface.catalogId =
    "https://example.com/c.json";
  assert.equal(parseInlineBlock("a2ui", JSON.stringify(other))?.kind, "fallback");
});
