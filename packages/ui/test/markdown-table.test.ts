import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { cellsCsv, MarkdownView, tableMarkdown } from "../dist/index.js";

test("a table copies back as Markdown with its alignment and escaped pipes", () => {
  const md = tableMarkdown({
    headers: ["Name", "Note", "Count"],
    rows: [["Acme", "a | b", "2"], ["Northwind"]],
    align: ["left", "center", "right"],
  });
  assert.equal(md, "| Name | Note | Count |\n| --- | :---: | ---: |\n| Acme | a \\| b | 2 |\n| Northwind |  |  |");
});

test("a table copies as CSV with fields that hold commas, quotes or breaks quoted", () => {
  assert.equal(
    cellsCsv([
      ["Name", "Note"],
      ["Acme, Inc.", 'says "hi"'],
      ["Northwind", "two\nlines"],
    ]),
    'Name,Note\r\n"Acme, Inc.","says ""hi"""\r\nNorthwind,"two\nlines"',
  );
});

test("a table renders in a scrolling frame with its copy actions under it, named by the app", () => {
  const html = renderToStaticMarkup(
    createElement(MarkdownView, {
      source: "| Name | Count |\n| --- | ---: |\n| Acme | 2 |",
      labels: { copyMarkdown: "Copiar como Markdown", copyCsv: "Copiar como CSV", maximize: "Maximizar tabla" },
    }),
  );
  assert.match(html, /class="apx-md__table"/);
  assert.match(html, /class="apx-md__scroll"><table>/);
  assert.match(html, /class="apx-md__tableactions">.*Copiar como Markdown.*Copiar como CSV/);
  assert.match(html, /aria-label="Maximizar tabla"/);
});
