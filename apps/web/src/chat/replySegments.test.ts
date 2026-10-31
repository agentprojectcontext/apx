import assert from "node:assert/strict";
import { test } from "node:test";
import { replySegments } from "./replySegments.ts";

test("a page, a diagram and an email become cards between the bubbles around them", () => {
  const text = [
    "Here is the banner:",
    "```html",
    "<h2>Hi</h2>",
    "```",
    "And the plan:",
    "```Mermaid",
    "flowchart LR",
    "  A --> B",
    "```",
  ].join("\n");
  assert.deepEqual(replySegments(text), [
    { kind: "text", text: "Here is the banner:" },
    { kind: "block", lang: "html", code: "<h2>Hi</h2>", open: false },
    { kind: "text", text: "And the plan:" },
    { kind: "block", lang: "mermaid", code: "flowchart LR\n  A --> B", open: false },
  ]);
});

test("any code block is a card, a block without a language too", () => {
  assert.deepEqual(replySegments("Run:\n```bash\nls\n```\nOr:\n```\npwd\n```"), [
    { kind: "text", text: "Run:" },
    { kind: "block", lang: "bash", code: "ls", open: false },
    { kind: "text", text: "Or:" },
    { kind: "block", lang: "", code: "pwd", open: false },
  ]);
});

test("a block still being written is open, with what arrived so far", () => {
  assert.deepEqual(replySegments("Drawing it:\n```html\n<section>\n  <h2>Ver"), [
    { kind: "text", text: "Drawing it:" },
    { kind: "block", lang: "html", code: "<section>\n  <h2>Ver", open: true },
  ]);
  assert.deepEqual(replySegments("```mermaid"), [{ kind: "block", lang: "mermaid", code: "", open: true }]);
});

test("words alone are one bubble, and blank space between cards makes none", () => {
  assert.deepEqual(replySegments("Done."), [{ kind: "text", text: "Done." }]);
  assert.deepEqual(
    replySegments("```html\n<p>a</p>\n```\n\n```html\n<p>b</p>\n```").map((s) => s.kind),
    ["block", "block"],
  );
});
