// Four parsers with four different key patterns meant the same file read by
// two code paths yielded different fields, silently — a non-matching line is
// just skipped, so nothing ever errored. These tests pin the union behaviour.
import test from "node:test";
import assert from "node:assert/strict";

import {
  parseFrontmatter,
  parseFrontmatterFields,
  setFrontmatterField,
} from "#core/apc/frontmatter.js";

test("no frontmatter: the whole text is the body", () => {
  const r = parseFrontmatter("# Just a heading\n\nbody");
  assert.deepEqual(r.fm, {});
  assert.equal(r.body, "# Just a heading\n\nbody");
  assert.equal(r.bodyStart, 0);
});

test("unterminated frontmatter is not treated as frontmatter", () => {
  const r = parseFrontmatter("---\nagent: sofia\nno closing fence");
  assert.deepEqual(r.fm, {});
  assert.equal(r.bodyStart, 0);
});

test("parses fields and returns the body separately", () => {
  const r = parseFrontmatter("---\nagent: sofia\nstarted: 2026-08-16T10:00:00Z\n---\n\nThe body.\n");
  assert.deepEqual(r.fm, { agent: "sofia", started: "2026-08-16T10:00:00Z" });
  assert.equal(r.body, "The body.\n");
  assert.ok(r.bodyStart > 0);
});

// The actual bug: these key shapes parsed in some copies and vanished in others.
test("keys may contain digits and dashes", () => {
  const fm = parseFrontmatterFields(
    "---\nroute_to_agent2: sofia\nagent-slug: reviewer\nplain: ok\n---\nbody"
  );
  assert.deepEqual(fm, {
    route_to_agent2: "sofia",
    "agent-slug": "reviewer",
    plain: "ok",
  });
});

test("quoted values are unquoted, single or double", () => {
  const fm = parseFrontmatterFields(`---\na: "quoted"\nb: 'single'\nc: bare\n---\nx`);
  assert.deepEqual(fm, { a: "quoted", b: "single", c: "bare" });
});

test("a lone quote is not stripped", () => {
  assert.deepEqual(parseFrontmatterFields(`---\na: "\n---\nx`), { a: '"' });
});

test("a bare --- opener is accepted", () => {
  assert.deepEqual(parseFrontmatterFields("---\nname: x\n---\nbody"), { name: "x" });
});

test("values keep inner colons and are trimmed", () => {
  const fm = parseFrontmatterFields("---\nurl:   https://example.com/a:b   \n---\nx");
  assert.equal(fm.url, "https://example.com/a:b");
});

test("lines that are not key: value are skipped, not fatal", () => {
  const fm = parseFrontmatterFields("---\nok: 1\n# a comment\n   \n2bad: nope\n---\nx");
  assert.deepEqual(fm, { ok: "1" });
});

test("setFrontmatterField: replaces an existing field, preserves the rest", () => {
  const src = "---\nagent: sofia\nstatus: open\n---\n\nBody stays.\n";
  const out = setFrontmatterField(src, "status", "closed");
  assert.deepEqual(parseFrontmatterFields(out), { agent: "sofia", status: "closed" });
  assert.ok(out.endsWith("\nBody stays.\n"));
});

test("setFrontmatterField: appends a missing field", () => {
  const out = setFrontmatterField("---\nagent: sofia\n---\nbody", "status", "open");
  assert.deepEqual(parseFrontmatterFields(out), { agent: "sofia", status: "open" });
});

test("setFrontmatterField: no frontmatter means no change", () => {
  assert.equal(setFrontmatterField("plain text", "a", "b"), "plain text");
});

test("null and undefined are handled like empty input", () => {
  for (const v of [null, undefined, ""]) {
    const r = parseFrontmatter(v);
    assert.deepEqual(r.fm, {});
    assert.equal(r.body, "");
  }
});
