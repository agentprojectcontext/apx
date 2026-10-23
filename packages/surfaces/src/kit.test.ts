import assert from "node:assert/strict";
import { test } from "node:test";
import { declaresApp, declaresLive, inlineKit, parseLiveDuration, usesKit } from "./kit.ts";

const KIT = "window.APX={kit:'1'};";

test("the kit tag is replaced by the kit inline, in every accepted spelling", () => {
  for (const tag of [
    '<script src="/_apx/kit@1.js"></script>',
    "<script src='/_apx/kit@1.2.js' defer></script>",
    "<script src=/_apx/kit@1.js>\n</script>",
    '<SCRIPT type="text/javascript" SRC="/_apx/kit@1.2.0.js"></SCRIPT>',
  ]) {
    const html = `<head>${tag}</head><body><main class="ax-page">Overview</main></body>`;
    assert.ok(usesKit(html), tag);
    assert.equal(
      inlineKit(html, KIT),
      `<head><script data-apx-kit>${KIT}</script></head><body><main class="ax-page">Overview</main></body>`,
    );
  }
});

test("only the first kit tag runs: repeats are dropped, other scripts stay", () => {
  const html = '<script src="/_apx/kit@1.js"></script><script>go()</script><script src="/_apx/kit@1.js"></script>';
  assert.equal(inlineKit(html, KIT), `<script data-apx-kit>${KIT}</script><script>go()</script>`);
});

test("pages without the kit, or asking another file, are left alone", () => {
  for (const html of [
    "<main>Overview</main>",
    '<script src="https://cdn.example.com/_apx/kit@1.js"></script>',
    '<script src="/_apx/kit@2.js"></script>',
  ]) {
    assert.equal(usesKit(html), false, html);
    assert.equal(inlineKit(html, KIT), html);
  }
});

test("a kit containing a closing script tag cannot end the inline element early", () => {
  const out = inlineKit('<script src="/_apx/kit@1.js"></script>', 'var s="</script><b>";');
  assert.equal(out, '<script data-apx-kit>var s="<\\/script><b>";</script>');
});

test("an app is declared by the meta tag or the html attribute, not by mentioning it", () => {
  assert.ok(declaresApp('<meta name="apx-surface" content="app">'));
  assert.ok(declaresApp("<meta content=app name=apx-surface>"));
  assert.ok(declaresApp('<html lang="en" data-ax-surface="app"><body></body></html>'));
  assert.equal(declaresApp('<meta name="apx-surface" content="widget">'), false);
  assert.equal(declaresApp("<p>Use data-ax-surface for apps</p>"), false);
});

test("a live page declares it with a meta tag, on or for a while after it was last seen", () => {
  assert.equal(declaresLive('<meta name="apx-live" content="on">'), Number.POSITIVE_INFINITY);
  assert.equal(declaresLive("<meta content=15m name=apx-live>"), 15 * 60_000);
  assert.equal(declaresLive("<META NAME='apx-live' CONTENT='2h'>"), 2 * 3_600_000);
  assert.equal(declaresLive('<meta name="apx-live" content="off">'), undefined);
  assert.equal(declaresLive('<meta name="apx-live" content="soon">'), undefined);
  assert.equal(declaresLive('<meta name="apx-live">'), undefined);
  assert.equal(declaresLive("<p>Add apx-live to keep it running</p>"), undefined);
  assert.equal(declaresLive('<meta name="apx-surface" content="app">'), undefined);
});

test("live durations read seconds to days; zero or anything else is not live", () => {
  assert.equal(parseLiveDuration("30s"), 30_000);
  assert.equal(parseLiveDuration(" 1D "), 86_400_000);
  assert.equal(parseLiveDuration("true"), Number.POSITIVE_INFINITY);
  for (const v of ["0m", "15", "m", "-5m", "1.5h", ""]) assert.equal(parseLiveDuration(v), undefined, v);
});
