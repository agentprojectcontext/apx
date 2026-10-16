import assert from "node:assert/strict";
import { test } from "node:test";
import type { CoreEvent, Message, Part } from "@apx/protocol";
import { MarkdownView } from "@apx/ui";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { chatDocuments, documentToOpen, withStored } from "./documents.ts";

const doc: Extract<Part, { type: "file" }> = {
  type: "file",
  media_id: "doc1",
  name: "Report.txt",
  mime: "text/plain",
  bytes: 10,
  document: { title: "Report", format: "markdown" },
};
const event = (part: Part, thread = "visible"): CoreEvent => ({
  type: "message.part",
  thread_id: thread,
  message_id: "m1",
  index: 0,
  part,
});

test("only document presentations in the visible chat open a panel", () => {
  assert.equal(documentToOpen(event(doc), "visible"), doc);
  assert.equal(documentToOpen(event(doc, "background"), "visible"), undefined);
  assert.equal(documentToOpen(event(doc), undefined), undefined);
  assert.equal(documentToOpen(event({ ...doc, document: undefined }), "visible"), undefined);
  assert.equal(documentToOpen(event({ type: "changes", cwd: ".", files: [] }), "visible"), undefined);
  assert.equal(
    documentToOpen(event({ type: "surface", surface_id: "s1", title: "App", version: 1 }), "visible"),
    undefined,
  );
});

test("document history is scoped to the current chat, newest first", () => {
  const message = (thread: string, parts: Part[]): Message => ({
    id: thread,
    thread_id: thread,
    seq: 1,
    author: { kind: "user" },
    parts,
    created_at: "",
  });
  const newer = { ...doc, media_id: "doc2" };
  assert.deepEqual(chatDocuments([message("visible", [doc, newer]), message("background", [doc])], "visible"), [
    newer,
    doc,
  ]);
});

test("Markdown document tables preserve alignment and safely render emphasis, code and escaped pipes", () => {
  const html = renderToStaticMarkup(
    createElement(MarkdownView, {
      source: "# Report\n\n| Name | Status |\n| :--- | ---: |\n| **Acme** | `ready` |\n| Northwind \\| west | Done |",
    }),
  );
  assert.match(html, /<h3>Report<\/h3>/);
  assert.match(html, /<table>/);
  assert.match(html, /text-align:right/);
  assert.match(html, /<strong>Acme<\/strong>/);
  assert.match(html, /<code>ready<\/code>/);
  assert.match(html, /Northwind \| west/);
});

test("document HTML and unsafe URLs remain inert, including in tables and code fences", () => {
  const html = renderToStaticMarkup(
    createElement(MarkdownView, {
      source:
        "| Item | Value |\n| --- | --- |\n| <script>alert(1)</script> | [Click](javascript:alert) |\n\n```\n| A | B |\n| --- | --- |\n```",
    }),
  );
  assert.doesNotMatch(html, /<script|href="javascript/);
  assert.match(html, /&lt;script&gt;/);
  assert.equal((html.match(/<table>/g) ?? []).length, 1);
  assert.match(html, /<pre><code>\| A \| B \|/);
});

test("sparse wide tables cannot expand a bounded document into unbounded cells", () => {
  const header = `|${" A |".repeat(64)}`;
  const separator = `|${" --- |".repeat(64)}`;
  const table = `${header}\n${separator}\n${"|\n".repeat(150)}\n`;
  const source = `${table.repeat(30)}Last paragraph`;
  const html = renderToStaticMarkup(createElement(MarkdownView, { source }));
  assert.ok((html.match(/<t[hd](?: | >|>)/g) ?? []).length <= 10_000);
  assert.match(html, /Last paragraph/);
});

test("a chat's old documents the transcript did not load still list, after the loaded ones, each once", () => {
  const isDoc = (p: Part): p is Parameters<typeof withStored>[0][number] => p.type === "file" && !!p.document;
  const loaded = [doc].filter(isDoc);
  const stored = [
    { media_id: "doc1", name: "Report.txt", title: "Report", format: "markdown" as const },
    { media_id: "old", name: "Guide.md", title: "Guide", format: "markdown" as const },
  ];
  assert.deepEqual(
    withStored(loaded, stored).map((d) => d.media_id),
    ["doc1", "old"],
  );
  assert.deepEqual(withStored([], []), []);
});
