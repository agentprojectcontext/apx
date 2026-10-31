import assert from "node:assert/strict";
import { test } from "node:test";
import { htmlPreviewDoc, isPreviewHeight } from "./htmlPreview.ts";

const cspOf = (doc: string) => /http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(doc)?.[1] ?? "";

test("an agent's HTML runs no script of its own and loads nothing from the web", () => {
  const doc = htmlPreviewDoc('<p onclick="steal()">Hi</p><script>steal()</script>', "k1");
  const csp = cspOf(doc);
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /script-src 'nonce-k1';/);
  assert.doesNotMatch(csp, /script-src[^;]*unsafe|unsafe-eval|https?:|\*/);
  assert.match(csp, /form-action 'none'/);
  // Only the host's sizing script carries the nonce; the page's own script stays as written, without it.
  assert.equal(doc.match(/nonce="k1"/g)?.length, 1);
  assert.match(doc, /<script>steal\(\)<\/script>/);
});

test("a fragment becomes a whole page and a full page keeps its own head, the lock first", () => {
  assert.match(
    htmlPreviewDoc("<section>Launch</section>", "k"),
    /^<!doctype html><html><head><meta charset.*<body><section>/s,
  );
  const full = htmlPreviewDoc("<!doctype html><html><head><title>A</title></head><body>B</body></html>", "k");
  assert.ok(full.indexOf("Content-Security-Policy") < full.indexOf("<title>A</title>"));
});

test("only a height message with the frame's own key counts", () => {
  assert.equal(isPreviewHeight({ apxPreview: "k", height: 120 }, "k"), true);
  assert.equal(isPreviewHeight({ apxPreview: "other", height: 120 }, "k"), false);
  assert.equal(isPreviewHeight({ apxPreview: "k", height: "120" }, "k"), false);
  assert.equal(isPreviewHeight({ apxPreview: "k", height: Number.POSITIVE_INFINITY }, "k"), false);
  assert.equal(isPreviewHeight(null, "k"), false);
});
