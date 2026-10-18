import assert from "node:assert/strict";
import { test } from "node:test";
import { injectSurfaceHead } from "./widget-kit.ts";

test("a fragment's header is preserved inside the body, never mistaken for the document head", () => {
  const fragment = "<main><header><h1>Overview</h1></header></main>";
  const head = '<meta charset="utf-8"><style>.example{display:grid}</style>';
  assert.equal(
    injectSurfaceHead(fragment, head),
    `<!doctype html><html><head>${head}</head><body>${fragment}</body></html>`,
  );
});

test("full documents receive the host head before their own styles without duplicating the head", () => {
  const author = "<style>body{padding:20px}</style>";
  const head = '<meta name="viewport" content="width=device-width,initial-scale=1">';
  const doc = injectSurfaceHead(`<html lang="en"><head>${author}</head><body>Example</body></html>`, head);
  assert.equal(doc, `<html lang="en"><head>${head}${author}</head><body>Example</body></html>`);
  assert.equal(
    injectSurfaceHead('<html lang="en"><body>Example</body></html>', head),
    `<html lang="en"><head>${head}</head><body>Example</body></html>`,
  );
});

test("custom elements and head-like strings in comments or scripts cannot capture the host head", () => {
  const head = '<meta http-equiv="Content-Security-Policy" content="default-src none">';
  for (const fragment of [
    "<main><head-banner>Overview</head-banner></main>",
    "<!-- <head> --><main>Overview</main>",
    '<script>const example = "<head>";</script>',
    "<html-widget>Overview</html-widget>",
  ]) {
    assert.ok(injectSurfaceHead(fragment, head).startsWith(`<!doctype html><html><head>${head}</head>`));
  }
  const full = "<!doctype html><html><!-- <head> --><head><title>Overview</title></head><body></body></html>";
  assert.equal(
    injectSurfaceHead(full, head),
    `<!doctype html><html><!-- <head> --><head>${head}<title>Overview</title></head><body></body></html>`,
  );
});
