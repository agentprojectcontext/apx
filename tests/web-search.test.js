import { test } from "node:test";
import assert from "node:assert/strict";
import { unwrapDdgUrl, parseDdgResults } from "#core/http-tools/search.js";

test("unwrapDdgUrl decodes the //duckduckgo.com/l/?uddg= redirect", () => {
  const wrapped =
    "//duckduckgo.com/l/?uddg=https%3A%2F%2Fclaude.com%2Fproduct%2Foverview&rut=abc123";
  assert.equal(unwrapDdgUrl(wrapped), "https://claude.com/product/overview");
});

test("unwrapDdgUrl handles &amp;-escaped uddg params", () => {
  const wrapped = "//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa&amp;rut=x";
  assert.equal(unwrapDdgUrl(wrapped), "https://example.com/a");
});

test("unwrapDdgUrl normalizes a bare protocol-relative URL to https", () => {
  assert.equal(unwrapDdgUrl("//example.com/x"), "https://example.com/x");
});

test("unwrapDdgUrl leaves a plain absolute URL untouched", () => {
  assert.equal(unwrapDdgUrl("https://example.com/x"), "https://example.com/x");
});

// Regression: DDG wraps every external link in a /l/?uddg= redirect. The old
// parser dropped anything containing "duckduckgo.com", so it returned zero
// results even on a full page of hits. This fixture reproduces the current DOM.
test("parseDdgResults extracts results despite the duckduckgo.com redirect wrapper", () => {
  const html = `
    <div class="result">
      <h2 class="result__title">
        <a rel="nofollow" class="result__a"
           href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.anthropic.com%2Fclaude%2Fopus&amp;rut=aaa">
          Claude Opus 4.8 &#92; Anthropic
        </a>
      </h2>
      <a class="result__snippet"
         href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.anthropic.com%2Fclaude%2Fopus&amp;rut=aaa">
        Anthropic&#x27;s most capable model.
      </a>
    </div>
    <div class="result">
      <h2 class="result__title">
        <a rel="nofollow" class="result__a"
           href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fen.wikipedia.org%2Fwiki%2FClaude&amp;rut=bbb">
          Claude (language model) - Wikipedia
        </a>
      </h2>
      <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fen.wikipedia.org%2Fwiki%2FClaude&amp;rut=bbb">
        Claude is a family of large language models.
      </a>
    </div>`;

  const results = parseDdgResults(html, 5);
  assert.equal(results.length, 2);
  assert.equal(results[0].url, "https://www.anthropic.com/claude/opus");
  // numeric HTML entities decoded
  assert.equal(results[0].title, "Claude Opus 4.8 \\ Anthropic");
  assert.match(results[0].snippet, /Anthropic's most capable/);
  assert.equal(results[1].url, "https://en.wikipedia.org/wiki/Claude");
  // no result should still carry the duckduckgo.com redirect host
  for (const r of results) assert.ok(!/duckduckgo\.com/.test(r.url));
});
