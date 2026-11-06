import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FileTile, FileTileGrid } from "../dist/index.js";

test("a file without a picture is named by its file name and shows its size", () => {
  const html = renderToStaticMarkup(h(FileTile, { name: "notes.md", meta: "4 KB", onOpen: () => {} }));
  assert.match(html, /aria-label="notes.md"/);
  assert.match(html, /apx-filetile__meta">4 KB</);
  assert.doesNotMatch(html, /is-picture/);
  assert.doesNotMatch(html, /disabled/);
});

test("a picture fills the tile and names the button through its alt text", () => {
  const html = renderToStaticMarkup(h(FileTile, { name: "brief.png", src: "blob:brief" }));
  assert.match(html, /is-picture/);
  assert.match(html, /<img src="blob:brief" alt="brief.png"/);
  assert.doesNotMatch(html, /aria-label="brief.png"/);
  assert.match(html, /disabled/);
});

test("actions render only when given, and the grid is a named list", () => {
  assert.doesNotMatch(renderToStaticMarkup(h(FileTile, { name: "a.txt" })), /apx-filetile__actions/);
  const html = renderToStaticMarkup(
    h(FileTileGrid, { label: "Attachments" }, h(FileTile, { name: "a.txt", actions: h("span", null, "x") })),
  );
  assert.match(html, /<ul class="apx-filetiles" aria-label="Attachments"><li class="apx-filetile"/);
  assert.match(html, /apx-filetile__actions/);
});
