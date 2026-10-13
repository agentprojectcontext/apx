import assert from "node:assert/strict";
import { test } from "node:test";
import { MarkdownView } from "@apx/ui";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const draft = "Te dejo esto:\n\n> Hi **team**!\n>\n> Docs: [site](https://example.com)\n\nLo dejaría así.";

test("quoted lines render as one quote with its own paragraphs, not as raw > marks", () => {
  const html = renderToStaticMarkup(createElement(MarkdownView, { source: draft }));
  assert.ok(!html.includes("&gt;"), html);
  assert.match(
    html,
    /<blockquote class="apx-md__quote"><p>Hi <strong>team<\/strong>!<\/p><p>Docs: <a [^>]*>site<\/a><\/p><\/blockquote>/,
  );
  assert.match(html, /<p>Lo dejaría así\.<\/p><\/div>$/);
});

test("a quote's renderer gets its words without the marks, to copy", () => {
  const copied: string[] = [];
  renderToStaticMarkup(
    createElement(MarkdownView, {
      source: draft,
      renderQuote: (text, quote) => {
        copied.push(text);
        return createElement(Fragment, null, quote);
      },
    }),
  );
  assert.deepEqual(copied, ["Hi team!\n\nDocs: site"]);
});
